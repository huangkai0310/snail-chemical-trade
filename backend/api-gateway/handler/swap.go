package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/middleware"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
	engine "github.com/huangkai0310/snail-chemical-trade/matching-engine"
)

// SwapListing 换盘挂牌结构体
type SwapListing struct {
	ID        uuid.UUID `json:"id"`
	SerialNo  int64     `json:"serial_no"` // 唯一自增序号，供前端展示和搜索
	UserID    uuid.UUID `json:"user_id"`

	// 我方卖出
	SellProductID        string  `json:"sell_product_id"`
	SellPrice            float64 `json:"sell_price"`
	SellQuantity         float64 `json:"sell_quantity"`
	SellFilled           float64 `json:"sell_filled"`           // 已还盘数量（多方凑满进度）
	SellDeliveryPeriod   *string `json:"sell_delivery_period,omitempty"`
	SellDeliveryLocation *string `json:"sell_delivery_location,omitempty"`

	// 我方换入
	BuyProductID        string  `json:"buy_product_id"`
	BuyPrice            float64 `json:"buy_price"`
	BuyQuantity         float64 `json:"buy_quantity"`
	BuyFilled           float64 `json:"buy_filled"`             // 已还盘数量
	BuyDeliveryPeriod   *string `json:"buy_delivery_period,omitempty"`
	BuyDeliveryLocation *string `json:"buy_delivery_location,omitempty"`

	SellAllowPartial bool    `json:"sell_allow_partial"` // 卖出是否允许拆单
	SellMinQuantity  float64 `json:"sell_min_quantity"`  // 卖出最小成交量（0=无限制）
	SellPaymentMethod *string `json:"sell_payment_method,omitempty"`
	SellDeliveryMethod *string `json:"sell_delivery_method,omitempty"` // 卖出交割方式（混罐货转/货转/自提/送到）
	SellFreeStorageEnabled bool `json:"sell_free_storage_enabled"`     // 卖出是否可免仓
	SellFreeStorageDays *int  `json:"sell_free_storage_days,omitempty"` // 卖出免仓天数
	SellSpecs json.RawMessage `json:"sell_specs,omitempty"`            // 卖出规格
	BuyAllowPartial  bool    `json:"buy_allow_partial"`  // 换入是否允许拆单
	BuyMinQuantity   float64 `json:"buy_min_quantity"`   // 换入最小成交量（0=无限制）
	BuyPaymentMethod  *string `json:"buy_payment_method,omitempty"`
	BuyDeliveryMethod *string `json:"buy_delivery_method,omitempty"`   // 换入交割方式
	BuyFreeStorageEnabled bool `json:"buy_free_storage_enabled"`       // 换入是否可免仓
	BuyFreeStorageDays *int  `json:"buy_free_storage_days,omitempty"`  // 换入免仓天数
	BuySpecs  json.RawMessage `json:"buy_specs,omitempty"`             // 换入规格

	SellAllowCounterOffer bool            `json:"sell_allow_counter_offer"`       // 卖出腿是否接受商谈
	SellNegotiableTerms   json.RawMessage `json:"sell_negotiable_terms,omitempty"` // 卖出腿可议条款范围
	BuyAllowCounterOffer  bool            `json:"buy_allow_counter_offer"`         // 买入腿是否接受商谈
	BuyNegotiableTerms    json.RawMessage `json:"buy_negotiable_terms,omitempty"`  // 买入腿可议条款范围

	// 兼容旧字段（从 sell/buy 推导）
	AllowCounterOffer bool            `json:"allow_counter_offer"`                 // 任意一腿可商谈则为 true
	NegotiableTerms   json.RawMessage `json:"negotiable_terms,omitempty"`          // 合并的可议条款

	// 单边交易设置
	AllowSingleSide bool   `json:"allow_single_side"` // 是否允许单边交易（默认 true）
	SingleSideMode  string `json:"single_side_mode"`  // both | single_buy | single_sell | none（默认 both）

	Remark    *string    `json:"remark,omitempty"`
	Status    string     `json:"status"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	StartsAt  *time.Time `json:"starts_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

// CreateSwapRequest 创建换盘请求
type CreateSwapRequest struct {
	// 我方卖出
	SellProductID        string  `json:"sell_product_id" binding:"required"`
	SellPrice            float64 `json:"sell_price" binding:"required,gt=0"`
	SellQuantity         float64 `json:"sell_quantity" binding:"required,gt=0"`
	SellDeliveryPeriod   string  `json:"sell_delivery_period"`
	SellDeliveryLocation string  `json:"sell_delivery_location"`
	SellPaymentMethod    string  `json:"sell_payment_method"`
	SellDeliveryMethod   string  `json:"sell_delivery_method"`    // 卖出交割方式
	SellFreeStorageEnabled *bool `json:"sell_free_storage_enabled"` // 卖出是否可免仓（默认 true）
	SellFreeStorageDays  *int    `json:"sell_free_storage_days"`   // 卖出免仓天数
	SellSpecs            json.RawMessage `json:"sell_specs"`       // 卖出规格

	// 我方换入
	BuyProductID         string  `json:"buy_product_id" binding:"required"`
	BuyPrice             float64 `json:"buy_price" binding:"required,gt=0"`
	BuyQuantity          float64 `json:"buy_quantity" binding:"required,gt=0"`
	BuyDeliveryPeriod    string  `json:"buy_delivery_period"`
	BuyDeliveryLocation  string  `json:"buy_delivery_location"`
	BuyPaymentMethod     string  `json:"buy_payment_method"`
	BuyDeliveryMethod    string  `json:"buy_delivery_method"`      // 换入交割方式
	BuyFreeStorageEnabled *bool `json:"buy_free_storage_enabled"`  // 换入是否可免仓（默认 true）
	BuyFreeStorageDays   *int    `json:"buy_free_storage_days"`    // 换入免仓天数
	BuySpecs             json.RawMessage `json:"buy_specs"`        // 换入规格

	// 拆单设置（默认不可拆，买卖共用）
	SellAllowPartial *bool   `json:"sell_allow_partial"`
	SellMinQuantity  float64 `json:"sell_min_quantity"`
	BuyAllowPartial  *bool   `json:"buy_allow_partial"`
	BuyMinQuantity   float64 `json:"buy_min_quantity"`

	// 卖出腿商谈设置（默认 false）
	SellAllowCounterOffer *bool `json:"sell_allow_counter_offer"`
	SellNegotiableTerms   json.RawMessage `json:"sell_negotiable_terms"`

	// 买入腿商谈设置（默认 false）
	BuyAllowCounterOffer *bool `json:"buy_allow_counter_offer"`
	BuyNegotiableTerms   json.RawMessage `json:"buy_negotiable_terms"`

	// 兼容旧字段
	AllowCounterOffer *bool `json:"allow_counter_offer"`
	NegotiableTerms   json.RawMessage `json:"negotiable_terms"`

	// 单边交易设置
	AllowSingleSide *bool  `json:"allow_single_side"` // 是否允许单边交易（默认 true）
	SingleSideMode  string `json:"single_side_mode"`  // both | single_buy | single_sell | none（默认 both）

	Remark string `json:"remark"`

	ExpiresAt *string `json:"expires_at"` // 过期时间 RFC3339；空则默认当日 18:00
	StartsAt  *string `json:"starts_at"`  // 开始时间；空=立即
}

// UpdateSwapRequest 编辑换盘请求（与 CreateSwapRequest 对应，但部分字段加指针以便区分"未传"和"零值"）
type UpdateSwapRequest struct {
	// 我方卖出
	SellProductID        string  `json:"sell_product_id" binding:"required"`
	SellPrice            float64 `json:"sell_price" binding:"required,gt=0"`
	SellQuantity         float64 `json:"sell_quantity" binding:"required,gt=0"`
	SellDeliveryPeriod   string  `json:"sell_delivery_period"`
	SellDeliveryLocation string  `json:"sell_delivery_location"`
	SellPaymentMethod    string  `json:"sell_payment_method"`
	SellDeliveryMethod   string  `json:"sell_delivery_method"`
	SellFreeStorageEnabled *bool `json:"sell_free_storage_enabled"`
	SellFreeStorageDays  *int    `json:"sell_free_storage_days"`
	SellSpecs            json.RawMessage `json:"sell_specs"`

	// 我方换入
	BuyProductID         string  `json:"buy_product_id" binding:"required"`
	BuyPrice             float64 `json:"buy_price" binding:"required,gt=0"`
	BuyQuantity          float64 `json:"buy_quantity" binding:"required,gt=0"`
	BuyDeliveryPeriod    string  `json:"buy_delivery_period"`
	BuyDeliveryLocation  string  `json:"buy_delivery_location"`
	BuyPaymentMethod     string  `json:"buy_payment_method"`
	BuyDeliveryMethod    string  `json:"buy_delivery_method"`
	BuyFreeStorageEnabled *bool `json:"buy_free_storage_enabled"`
	BuyFreeStorageDays   *int    `json:"buy_free_storage_days"`
	BuySpecs             json.RawMessage `json:"buy_specs"`

	// 拆单设置
	SellAllowPartial *bool   `json:"sell_allow_partial"`
	SellMinQuantity  float64 `json:"sell_min_quantity"`
	BuyAllowPartial  *bool   `json:"buy_allow_partial"`
	BuyMinQuantity   float64 `json:"buy_min_quantity"`

	// 卖出腿商谈设置
	SellAllowCounterOffer *bool `json:"sell_allow_counter_offer"`
	SellNegotiableTerms   json.RawMessage `json:"sell_negotiable_terms"`

	// 买入腿商谈设置
	BuyAllowCounterOffer *bool `json:"buy_allow_counter_offer"`
	BuyNegotiableTerms   json.RawMessage `json:"buy_negotiable_terms"`

	// 兼容旧字段
	AllowCounterOffer *bool `json:"allow_counter_offer"`
	NegotiableTerms   json.RawMessage `json:"negotiable_terms"`

	// 单边交易设置
	AllowSingleSide *bool  `json:"allow_single_side"` // 是否允许单边交易（默认 true）
	SingleSideMode  string `json:"single_side_mode"`  // both | single_buy | single_sell | none（默认 both）

	Remark string `json:"remark"`

	ExpiresAt *string `json:"expires_at"` // 过期时间；空则保留原值
	StartsAt  *string `json:"starts_at"`  // 开始时间；空=立即；未来=定时；未传则保留
}

type SwapHandler struct {
	pool             *pgxpool.Pool
	tradeRepo        *repo.TradeRepo
	coRepo           *repo.CounterOfferRepo
	blacklistRepo    *repo.BlacklistRepo
	listingRepo      *repo.ListingRepo
	broadcast        chan<- engine.Trade
	listingBroadcast chan<- engine.ListingEvent
	wsPush           func(targetUserID uuid.UUID, msgType string, payload interface{})
	afterCreateMatch func(ctx context.Context, swapID uuid.UUID)
}

func NewSwapHandler(pool *pgxpool.Pool) *SwapHandler {
	return &SwapHandler{pool: pool}
}

// SetTradeRepo 注入 tradeRepo（用于换盘单买/单卖时写入成交记录）
func (h *SwapHandler) SetTradeRepo(tradeRepo *repo.TradeRepo) {
	h.tradeRepo = tradeRepo
}

// SetBroadcast 注入 broadcast 通道（用于推送成交消息到 WebSocket）
func (h *SwapHandler) SetBroadcast(broadcast chan<- engine.Trade) {
	h.broadcast = broadcast
}

// SetListingBroadcast 注入 listingBroadcast 通道（用于推送发盘变更事件到 WebSocket）
func (h *SwapHandler) SetListingBroadcast(listingBroadcast chan<- engine.ListingEvent) {
	h.listingBroadcast = listingBroadcast
}

// SetCounterOfferRepo 注入议价 Repo（用于换盘撤销/成交时自动取消关联 PENDING 议价）
func (h *SwapHandler) SetCounterOfferRepo(coRepo *repo.CounterOfferRepo) {
	h.coRepo = coRepo
}

// SetBlacklistRepo 注入黑名单 Repo（用于换盘还盘前检查 + 列表标记）
func (h *SwapHandler) SetBlacklistRepo(blRepo *repo.BlacklistRepo) {
	h.blacklistRepo = blRepo
}

// SetListingRepo 注入 listing Repo（用于换盘锁单与普通挂牌自动撮合）
func (h *SwapHandler) SetListingRepo(lRepo *repo.ListingRepo) {
	h.listingRepo = lRepo
}

// SetAfterCreateMatch 换盘创建后触发剩余单边与挂牌自动撮合
func (h *SwapHandler) SetAfterCreateMatch(fn func(ctx context.Context, swapID uuid.UUID)) {
	h.afterCreateMatch = fn
}

// SetWSPush 注入 WebSocket 推送（换盘单边锁定/取消通知发牌方）
func (h *SwapHandler) SetWSPush(pushFunc func(targetUserID uuid.UUID, msgType string, payload interface{})) {
	h.wsPush = pushFunc
}

// Create 发布换盘挂牌
func (h *SwapHandler) Create(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req CreateSwapRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 对自由文本字段进行消毒
	req.SellDeliveryPeriod = sanitizeString(req.SellDeliveryPeriod, 100)
	req.SellDeliveryLocation = sanitizeString(req.SellDeliveryLocation, 200)
	req.SellPaymentMethod = sanitizeString(req.SellPaymentMethod, 100)
	req.SellDeliveryMethod = sanitizeString(req.SellDeliveryMethod, 50)
	req.BuyDeliveryPeriod = sanitizeString(req.BuyDeliveryPeriod, 100)
	req.BuyDeliveryLocation = sanitizeString(req.BuyDeliveryLocation, 200)
	req.BuyPaymentMethod = sanitizeString(req.BuyPaymentMethod, 100)
	req.BuyDeliveryMethod = sanitizeString(req.BuyDeliveryMethod, 50)
	req.Remark = sanitizeString(req.Remark, 500)

	// 校验：买卖数量必须一致
	if req.SellQuantity != req.BuyQuantity {
		c.JSON(http.StatusBadRequest, gin.H{"error": "卖出和换入的数量必须一致"})
		return
	}

	ctx := c.Request.Context()

	var swap SwapListing
	swap.UserID = userID

	var sellDP, sellDL, buyDP, buyDL, remark, sellPM, buyPM *string
	if req.SellDeliveryPeriod != "" {
		sellDP = &req.SellDeliveryPeriod
	}
	if req.SellDeliveryLocation != "" {
		sellDL = &req.SellDeliveryLocation
	}
	if req.BuyDeliveryPeriod != "" {
		buyDP = &req.BuyDeliveryPeriod
	}
	if req.BuyDeliveryLocation != "" {
		buyDL = &req.BuyDeliveryLocation
	}
	if req.SellPaymentMethod != "" {
		sellPM = &req.SellPaymentMethod
	}
	if req.BuyPaymentMethod != "" {
		buyPM = &req.BuyPaymentMethod
	}
	var sellDM, buyDM *string
	if req.SellDeliveryMethod != "" {
		sellDM = &req.SellDeliveryMethod
	}
	if req.BuyDeliveryMethod != "" {
		buyDM = &req.BuyDeliveryMethod
	}

	// 免仓期：默认可免仓（true）；显式传 false 时不免仓
	sellFSEnabled := true
	var sellFSDays *int
	if req.SellFreeStorageEnabled == nil || *req.SellFreeStorageEnabled {
		d := 3
		if req.SellQuantity >= 100 {
			d = 7
		}
		if req.SellFreeStorageDays != nil && *req.SellFreeStorageDays > 0 {
			d = *req.SellFreeStorageDays
		}
		sellFSDays = &d
	} else {
		sellFSEnabled = false
	}

	buyFSEnabled := true
	var buyFSDays *int
	if req.BuyFreeStorageEnabled == nil || *req.BuyFreeStorageEnabled {
		d := 3
		if req.BuyQuantity >= 100 {
			d = 7
		}
		if req.BuyFreeStorageDays != nil && *req.BuyFreeStorageDays > 0 {
			d = *req.BuyFreeStorageDays
		}
		buyFSDays = &d
	} else {
		buyFSEnabled = false
	}

	if req.Remark != "" {
		remark = &req.Remark
	}

	// 解析卖出/换入的 allow_partial，默认 false（不可拆）
	sellAllowPartial := false
	if req.SellAllowPartial != nil {
		sellAllowPartial = *req.SellAllowPartial
	}
	buyAllowPartial := false
	if req.BuyAllowPartial != nil {
		buyAllowPartial = *req.BuyAllowPartial
	}

	// 卖出腿商谈设置，默认 false
	sellAllowCounterOffer := false
	if req.SellAllowCounterOffer != nil {
		sellAllowCounterOffer = *req.SellAllowCounterOffer
	} else if req.AllowCounterOffer != nil {
		sellAllowCounterOffer = *req.AllowCounterOffer // 兼容旧字段
	}
	sellNegotiableTerms := req.SellNegotiableTerms
	if len(sellNegotiableTerms) == 0 || !json.Valid(sellNegotiableTerms) {
		if len(req.NegotiableTerms) > 0 && json.Valid(req.NegotiableTerms) {
			sellNegotiableTerms = req.NegotiableTerms // 兼容旧字段
		} else {
			sellNegotiableTerms = json.RawMessage(`[]`)
		}
	}

	// 买入腿商谈设置，默认 false
	buyAllowCounterOffer := false
	if req.BuyAllowCounterOffer != nil {
		buyAllowCounterOffer = *req.BuyAllowCounterOffer
	} else if req.AllowCounterOffer != nil {
		buyAllowCounterOffer = *req.AllowCounterOffer // 兼容旧字段
	}
	buyNegotiableTerms := req.BuyNegotiableTerms
	if len(buyNegotiableTerms) == 0 || !json.Valid(buyNegotiableTerms) {
		if len(req.NegotiableTerms) > 0 && json.Valid(req.NegotiableTerms) {
			buyNegotiableTerms = req.NegotiableTerms // 兼容旧字段
		} else {
			buyNegotiableTerms = json.RawMessage(`[]`)
		}
	}
	sellNegotiableTerms = sanitizeNegotiableTermsJSON(sellNegotiableTerms)
	buyNegotiableTerms = sanitizeNegotiableTermsJSON(buyNegotiableTerms)

	// 单边交易设置：默认允许，模式默认 both
	allowSingleSide := true
	if req.AllowSingleSide != nil {
		allowSingleSide = *req.AllowSingleSide
	}
	singleSideMode := "both"
	if req.SingleSideMode != "" {
		switch req.SingleSideMode {
		case "both", "single_buy", "single_sell", "none":
			singleSideMode = req.SingleSideMode
		default:
			singleSideMode = "both"
		}
	}
	if !allowSingleSide {
		singleSideMode = "none"
	}
	if singleSideMode == "none" {
		allowSingleSide = false
	}

	expiresAt, err := ResolveExpiresAt(req.ExpiresAt, time.Now())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	startsAt, scheduled, err := ResolveStartsAt(req.StartsAt, time.Now())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	status := "OPEN"
	if scheduled {
		status = "SCHEDULED"
		if !expiresAt.After(*startsAt) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "过期时间必须晚于开始时间"})
			return
		}
	}

	err = h.pool.QueryRow(ctx, `
		INSERT INTO swap_listings (
			user_id,
			sell_product_id, sell_price, sell_quantity, sell_delivery_period, sell_delivery_location,
			buy_product_id,  buy_price,  buy_quantity,  buy_delivery_period,  buy_delivery_location,
			remark, product_id,
			sell_allow_partial, sell_min_quantity,
			buy_allow_partial,  buy_min_quantity,
			sell_payment_method, buy_payment_method,
			sell_delivery_method, buy_delivery_method,
			sell_free_storage_enabled, buy_free_storage_enabled,
			sell_free_storage_days, buy_free_storage_days,
			sell_specs, buy_specs,
			sell_allow_counter_offer, sell_negotiable_terms,
			buy_allow_counter_offer, buy_negotiable_terms,
			allow_counter_offer, negotiable_terms,
			allow_single_side, single_side_mode,
			expires_at, starts_at, status
		) VALUES ($1, $2,$3,$4,$5,$6, $7,$8,$9,$10,$11, $12, $2,
		          $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
		          $27, $28, $29, $30, ($27 OR $29), CASE WHEN ($27 OR $29) THEN $28 ELSE '[]'::jsonb END,
		          $31, $32, $33, $34, $35)
		RETURNING id, serial_no, status, sell_filled, buy_filled, expires_at, starts_at, created_at, updated_at,
		          sell_delivery_method, buy_delivery_method,
		          sell_free_storage_enabled, buy_free_storage_enabled,
		          sell_free_storage_days, buy_free_storage_days,
		          sell_specs, buy_specs,
		          sell_negotiable_terms, buy_negotiable_terms,
		          allow_single_side, single_side_mode`,
		userID,
		req.SellProductID, req.SellPrice, req.SellQuantity, sellDP, sellDL,
		req.BuyProductID, req.BuyPrice, req.BuyQuantity, buyDP, buyDL,
		remark,
		sellAllowPartial, req.SellMinQuantity,
		buyAllowPartial,  req.BuyMinQuantity,
		sellPM, buyPM,
		sellDM, buyDM,
		sellFSEnabled, buyFSEnabled,
		sellFSDays, buyFSDays,
		req.SellSpecs, req.BuySpecs,
		sellAllowCounterOffer, sellNegotiableTerms,
		buyAllowCounterOffer, buyNegotiableTerms,
		allowSingleSide, singleSideMode,
		expiresAt, startsAt, status,
	).Scan(&swap.ID, &swap.SerialNo, &swap.Status, &swap.SellFilled, &swap.BuyFilled, &swap.ExpiresAt, &swap.StartsAt, &swap.CreatedAt, &swap.UpdatedAt,
		&swap.SellDeliveryMethod, &swap.BuyDeliveryMethod,
		&swap.SellFreeStorageEnabled, &swap.BuyFreeStorageEnabled,
		&swap.SellFreeStorageDays, &swap.BuyFreeStorageDays,
		&swap.SellSpecs, &swap.BuySpecs,
		&swap.SellNegotiableTerms, &swap.BuyNegotiableTerms,
		&swap.AllowSingleSide, &swap.SingleSideMode)
	if err != nil {
		log.Error().Err(err).Msg("创建换盘挂牌失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建换盘失败"})
		return
	}

	swap.SellProductID = req.SellProductID
	swap.SellPrice = req.SellPrice
	swap.SellQuantity = req.SellQuantity
	swap.SellDeliveryPeriod = sellDP
	swap.SellDeliveryLocation = sellDL
	swap.BuyProductID = req.BuyProductID
	swap.BuyPrice = req.BuyPrice
	swap.BuyQuantity = req.BuyQuantity
	swap.BuyDeliveryPeriod = buyDP
	swap.BuyDeliveryLocation = buyDL
	swap.Remark = remark
	swap.SellAllowPartial = sellAllowPartial
	swap.SellMinQuantity = req.SellMinQuantity
	swap.BuyAllowPartial = buyAllowPartial
	swap.BuyMinQuantity = req.BuyMinQuantity
	swap.SellPaymentMethod = sellPM
	swap.BuyPaymentMethod = buyPM
	swap.SellAllowCounterOffer = sellAllowCounterOffer
	swap.BuyAllowCounterOffer = buyAllowCounterOffer
	swap.AllowCounterOffer = sellAllowCounterOffer || buyAllowCounterOffer
	// 合并 sell/buy 的 negotiable_terms 作为兼容字段
	if sellAllowCounterOffer || buyAllowCounterOffer {
		swap.NegotiableTerms = sellNegotiableTerms
	} else {
		swap.NegotiableTerms = json.RawMessage(`[]`)
	}
	swap.AllowSingleSide = allowSingleSide
	swap.SingleSideMode = singleSideMode
	swap.StartsAt = startsAt
	swap.ExpiresAt = &expiresAt

	// 定时发布：不撮合、不广播给市场（列表仅本人可见）
	if status == "SCHEDULED" {
		c.JSON(http.StatusOK, gin.H{"swap": swap, "message": "已预约发布"})
		return
	}

	// 换盘剩余买/卖腿与同条款单买/单卖挂牌自动撮合
	if h.afterCreateMatch != nil {
		h.afterCreateMatch(c.Request.Context(), swap.ID)
	}

	// 实时推送：新换盘事件，让其他用户及时看到最新发盘
	if h.listingBroadcast != nil {
		h.listingBroadcast <- engine.ListingEvent{ProductID: swap.SellProductID}
	}

	c.JSON(http.StatusOK, gin.H{"swap": swap})
}

// List 获取换盘列表（按卖出品种筛选）
// GET /api/v1/swaps?product_id=benzene&page=1&page_size=20
func (h *SwapHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)
	productID := c.Query("product_id")
	serialNoQuery := c.Query("serial_no")
	var serialNo int64
	if serialNoQuery != "" {
		if n, err := strconv.ParseInt(serialNoQuery, 10, 64); err == nil {
			serialNo = n
		}
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	ctx := c.Request.Context()

	blockedSet := make(map[uuid.UUID]bool)
	var excludeIDs []uuid.UUID
	if h.blacklistRepo != nil && userID != uuid.Nil {
		blockedSet, _ = h.blacklistRepo.GetBlockedUserIDs(ctx, userID)
		if invisible, err := h.blacklistRepo.GetInvisiblePeerIDs(ctx, userID); err == nil && len(invisible) > 0 {
			excludeIDs = make([]uuid.UUID, 0, len(invisible))
			for id := range invisible {
				excludeIDs = append(excludeIDs, id)
			}
		}
	}

	query := `
		SELECT id, serial_no, user_id,
		       sell_product_id, sell_price, sell_quantity, sell_filled, sell_delivery_period, sell_delivery_location,
		       buy_product_id,  buy_price,  buy_quantity,  buy_filled,  buy_delivery_period,  buy_delivery_location,
		       sell_allow_partial, sell_min_quantity, buy_allow_partial, buy_min_quantity,
		       sell_payment_method, buy_payment_method,
		       sell_delivery_method, buy_delivery_method,
		       sell_free_storage_enabled, buy_free_storage_enabled,
		       sell_free_storage_days, buy_free_storage_days,
		       sell_specs, buy_specs,
		       remark, status, expires_at, starts_at, created_at, updated_at,
		       sell_allow_counter_offer, sell_negotiable_terms,
		       buy_allow_counter_offer, buy_negotiable_terms,
		       allow_counter_offer, negotiable_terms,
		       allow_single_side, single_side_mode
		FROM swap_listings
		WHERE (status = 'MATCHED' OR (status = 'OPEN' AND (expires_at IS NULL OR expires_at > NOW()))`
	args := []interface{}{}
	argIdx := 1

	if userID != uuid.Nil {
		query += ` OR (status = 'SCHEDULED' AND user_id = $` + strconv.Itoa(argIdx) + `)`
		args = append(args, userID)
		argIdx++
	}
	query += `)`

	if serialNo > 0 {
		query += ` AND serial_no = $` + strconv.Itoa(argIdx)
		args = append(args, serialNo)
		argIdx++
	} else if productID != "" {
		query += ` AND (sell_product_id = $` + strconv.Itoa(argIdx) + ` OR buy_product_id = $` + strconv.Itoa(argIdx) + `)`
		args = append(args, productID)
		argIdx++
	}

	if len(excludeIDs) > 0 {
		query += ` AND user_id <> ALL($` + strconv.Itoa(argIdx) + `)`
		args = append(args, excludeIDs)
		argIdx++
	}

	var total int
	countQuery := `SELECT COUNT(*) FROM swap_listings WHERE (status = 'MATCHED' OR (status = 'OPEN' AND (expires_at IS NULL OR expires_at > NOW()))`
	countArgs := []interface{}{}
	countIdx := 1
	if userID != uuid.Nil {
		countQuery += ` OR (status = 'SCHEDULED' AND user_id = $` + strconv.Itoa(countIdx) + `)`
		countArgs = append(countArgs, userID)
		countIdx++
	}
	countQuery += `)`
	if serialNo > 0 {
		countQuery += ` AND serial_no = $` + strconv.Itoa(countIdx)
		countArgs = append(countArgs, serialNo)
		countIdx++
	} else if productID != "" {
		countQuery += ` AND (sell_product_id = $` + strconv.Itoa(countIdx) + ` OR buy_product_id = $` + strconv.Itoa(countIdx) + `)`
		countArgs = append(countArgs, productID)
		countIdx++
	}
	if len(excludeIDs) > 0 {
		countQuery += ` AND user_id <> ALL($` + strconv.Itoa(countIdx) + `)`
		countArgs = append(countArgs, excludeIDs)
	}
	if err := h.pool.QueryRow(ctx, countQuery, countArgs...).Scan(&total); err != nil {
		log.Error().Err(err).Msg("统计换盘总数失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}

	query += ` ORDER BY created_at DESC LIMIT $` + strconv.Itoa(argIdx) + ` OFFSET $` + strconv.Itoa(argIdx+1)
	args = append(args, pageSize, offset)

	rows, err := h.pool.Query(ctx, query, args...)
	if err != nil {
		log.Error().Err(err).Msg("查询换盘列表失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	defer rows.Close()

	swaps := make([]SwapListing, 0)
	scanFailCount := 0
	for rows.Next() {
		var s SwapListing
		if err := rows.Scan(
			&s.ID, &s.SerialNo, &s.UserID,
			&s.SellProductID, &s.SellPrice, &s.SellQuantity, &s.SellFilled, &s.SellDeliveryPeriod, &s.SellDeliveryLocation,
			&s.BuyProductID, &s.BuyPrice, &s.BuyQuantity, &s.BuyFilled, &s.BuyDeliveryPeriod, &s.BuyDeliveryLocation,
			&s.SellAllowPartial, &s.SellMinQuantity, &s.BuyAllowPartial, &s.BuyMinQuantity,
			&s.SellPaymentMethod, &s.BuyPaymentMethod,
			&s.SellDeliveryMethod, &s.BuyDeliveryMethod,
			&s.SellFreeStorageEnabled, &s.BuyFreeStorageEnabled,
			&s.SellFreeStorageDays, &s.BuyFreeStorageDays,
			&s.SellSpecs, &s.BuySpecs,
			&s.Remark, &s.Status, &s.ExpiresAt, &s.StartsAt, &s.CreatedAt, &s.UpdatedAt,
			&s.SellAllowCounterOffer, &s.SellNegotiableTerms,
			&s.BuyAllowCounterOffer, &s.BuyNegotiableTerms,
			&s.AllowCounterOffer, &s.NegotiableTerms,
			&s.AllowSingleSide, &s.SingleSideMode,
		); err != nil {
			scanFailCount++
			log.Warn().Err(err).Int("scan_fail_count", scanFailCount).Msg("换盘列表 Scan 行失败")
			continue
		}
		swaps = append(swaps, s)
	}
	if scanFailCount > 0 {
		log.Warn().Int("total", total).Int("scan_fail_count", scanFailCount).Int("scanned", len(swaps)).Msg("换盘列表部分行 Scan 失败")
	}

	totalPage := (total + pageSize - 1) / pageSize
	if totalPage == 0 {
		totalPage = 1
	}

	type swapWithBlocked struct {
		SwapListing
		IsBlocked bool `json:"is_blocked"`
	}

	result := make([]swapWithBlocked, 0, len(swaps))
	for _, s := range swaps {
		result = append(result, swapWithBlocked{
			SwapListing: s,
			IsBlocked:   blockedSet[s.UserID],
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"data":       result,
		"total":      total,
		"page":       page,
		"page_size":  pageSize,
		"total_page": totalPage,
	})
}

// Update 编辑换盘挂牌
func (h *SwapHandler) Update(c *gin.Context) {
	userID := middleware.GetUserID(c)
	swapID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的换盘 ID"})
		return
	}

	var req UpdateSwapRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 对自由文本字段进行消毒
	req.SellDeliveryPeriod = sanitizeString(req.SellDeliveryPeriod, 100)
	req.SellDeliveryLocation = sanitizeString(req.SellDeliveryLocation, 200)
	req.SellPaymentMethod = sanitizeString(req.SellPaymentMethod, 100)
	req.SellDeliveryMethod = sanitizeString(req.SellDeliveryMethod, 50)
	req.BuyDeliveryPeriod = sanitizeString(req.BuyDeliveryPeriod, 100)
	req.BuyDeliveryLocation = sanitizeString(req.BuyDeliveryLocation, 200)
	req.BuyPaymentMethod = sanitizeString(req.BuyPaymentMethod, 100)
	req.BuyDeliveryMethod = sanitizeString(req.BuyDeliveryMethod, 50)

	// 校验：买卖数量必须一致
	if req.SellQuantity != req.BuyQuantity {
		c.JSON(http.StatusBadRequest, gin.H{"error": "卖出和换入的数量必须一致"})
		return
	}

	ctx := c.Request.Context()

	// 查原盘，校验 ownership + status
	var existing SwapListing
	err = h.pool.QueryRow(ctx, `
		SELECT id, user_id, sell_quantity, sell_filled, buy_quantity, buy_filled, status,
		       sell_free_storage_enabled, sell_free_storage_days,
		       buy_free_storage_enabled, buy_free_storage_days,
		       expires_at, starts_at
		FROM swap_listings WHERE id=$1`, swapID,
	).Scan(
		&existing.ID, &existing.UserID, &existing.SellQuantity, &existing.SellFilled,
		&existing.BuyQuantity, &existing.BuyFilled, &existing.Status,
		&existing.SellFreeStorageEnabled, &existing.SellFreeStorageDays,
		&existing.BuyFreeStorageEnabled, &existing.BuyFreeStorageDays,
		&existing.ExpiresAt, &existing.StartsAt,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "换盘不存在"})
		return
	}
	if existing.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "只能编辑自己的换盘"})
		return
	}
	if existing.Status != "OPEN" && existing.Status != "SCHEDULED" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该换盘状态不可编辑"})
		return
	}

	// 已成交部分不可缩减
	if req.SellQuantity < existing.SellFilled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "修改后的卖出数量不能少于已成交量"})
		return
	}
	if req.BuyQuantity < existing.BuyFilled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "修改后的换入数量不能少于已成交量"})
		return
	}

	// PENDING 商谈：禁止改可议条款 / 对应腿盘面条款
	if h.coRepo != nil {
		pending, _ := h.coRepo.CountPendingByRef(ctx, "swap", swapID)
		if pending > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该换盘已有待处理商谈，请先处理完商谈后再修改条款"})
			return
		}
	}

	// 待拼锁定：仅冻结对应侧条款；另一侧可改。保存时强制沿用锁定侧原条款，避免字段序列化差异误伤未锁侧。
	var sellLockQty, buyLockQty float64
	_ = h.pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(CASE WHEN match_side='sell' THEN matched_qty ELSE 0 END),0),
		        COALESCE(SUM(CASE WHEN match_side='buy' THEN matched_qty ELSE 0 END),0)
		 FROM swap_matches WHERE swap_a_id=$1 AND lock_status='ACTIVE' AND match_side IN ('sell','buy')`,
		swapID,
	).Scan(&sellLockQty, &buyLockQty)

	var (
		oldSellProductID, oldBuyProductID                     string
		oldSellPrice, oldBuyPrice                             float64
		oldSellDP, oldSellDL, oldSellPM, oldSellDM            *string
		oldBuyDP, oldBuyDL, oldBuyPM, oldBuyDM                *string
		oldSellFSEn, oldBuyFSEn                               bool
		oldSellFSD, oldBuyFSD                                 *int
		oldSellSpecs, oldBuySpecs                             json.RawMessage
		oldSellAllowCO, oldBuyAllowCO                         bool
		oldSellNT, oldBuyNT                                   json.RawMessage
		oldSellAllowPartial, oldBuyAllowPartial               bool
		oldSellMin, oldBuyMin                                 float64
	)
	_ = h.pool.QueryRow(ctx, `
		SELECT sell_product_id, buy_product_id, sell_price, buy_price,
		       sell_delivery_period, sell_delivery_location, sell_payment_method, sell_delivery_method,
		       buy_delivery_period, buy_delivery_location, buy_payment_method, buy_delivery_method,
		       sell_free_storage_enabled, buy_free_storage_enabled,
		       sell_free_storage_days, buy_free_storage_days,
		       sell_specs, buy_specs,
		       sell_allow_counter_offer, buy_allow_counter_offer,
		       sell_negotiable_terms, buy_negotiable_terms,
		       sell_allow_partial, buy_allow_partial,
		       sell_min_quantity, buy_min_quantity
		FROM swap_listings WHERE id=$1`, swapID,
	).Scan(
		&oldSellProductID, &oldBuyProductID, &oldSellPrice, &oldBuyPrice,
		&oldSellDP, &oldSellDL, &oldSellPM, &oldSellDM,
		&oldBuyDP, &oldBuyDL, &oldBuyPM, &oldBuyDM,
		&oldSellFSEn, &oldBuyFSEn, &oldSellFSD, &oldBuyFSD,
		&oldSellSpecs, &oldBuySpecs,
		&oldSellAllowCO, &oldBuyAllowCO, &oldSellNT, &oldBuyNT,
		&oldSellAllowPartial, &oldBuyAllowPartial, &oldSellMin, &oldBuyMin,
	)

	pinPtr := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	if sellLockQty > 0 {
		req.SellProductID = oldSellProductID
		req.SellPrice = oldSellPrice
		req.SellDeliveryPeriod = pinPtr(oldSellDP)
		req.SellDeliveryLocation = pinPtr(oldSellDL)
		req.SellPaymentMethod = pinPtr(oldSellPM)
		req.SellDeliveryMethod = pinPtr(oldSellDM)
		req.SellSpecs = oldSellSpecs
		req.SellFreeStorageEnabled = &oldSellFSEn
		req.SellFreeStorageDays = oldSellFSD
		req.SellAllowPartial = &oldSellAllowPartial
		req.SellMinQuantity = oldSellMin
		req.SellAllowCounterOffer = &oldSellAllowCO
		req.SellNegotiableTerms = oldSellNT
	}
	if buyLockQty > 0 {
		req.BuyProductID = oldBuyProductID
		req.BuyPrice = oldBuyPrice
		req.BuyDeliveryPeriod = pinPtr(oldBuyDP)
		req.BuyDeliveryLocation = pinPtr(oldBuyDL)
		req.BuyPaymentMethod = pinPtr(oldBuyPM)
		req.BuyDeliveryMethod = pinPtr(oldBuyDM)
		req.BuySpecs = oldBuySpecs
		req.BuyFreeStorageEnabled = &oldBuyFSEn
		req.BuyFreeStorageDays = oldBuyFSD
		req.BuyAllowPartial = &oldBuyAllowPartial
		req.BuyMinQuantity = oldBuyMin
		req.BuyAllowCounterOffer = &oldBuyAllowCO
		req.BuyNegotiableTerms = oldBuyNT
	}

	// 构建更新参数
	var sellDP, sellDL, buyDP, buyDL, remark, sellPM, buyPM *string
	if req.SellDeliveryPeriod != "" {
		sellDP = &req.SellDeliveryPeriod
	}
	if req.SellDeliveryLocation != "" {
		sellDL = &req.SellDeliveryLocation
	}
	if req.BuyDeliveryPeriod != "" {
		buyDP = &req.BuyDeliveryPeriod
	}
	if req.BuyDeliveryLocation != "" {
		buyDL = &req.BuyDeliveryLocation
	}
	if req.SellPaymentMethod != "" {
		sellPM = &req.SellPaymentMethod
	}
	if req.BuyPaymentMethod != "" {
		buyPM = &req.BuyPaymentMethod
	}
	var sellDM, buyDM *string
	if req.SellDeliveryMethod != "" {
		sellDM = &req.SellDeliveryMethod
	}
	if req.BuyDeliveryMethod != "" {
		buyDM = &req.BuyDeliveryMethod
	}
	if req.Remark != "" {
		remark = &req.Remark
	}

	// 免仓期处理（编辑未传天数时保留原值，不按数量自动补默认）
	sellFSEnabled := true
	var sellFSDays *int
	if req.SellFreeStorageEnabled == nil || *req.SellFreeStorageEnabled {
		sellFSEnabled = true
		if req.SellFreeStorageDays != nil && *req.SellFreeStorageDays > 0 {
			sellFSDays = req.SellFreeStorageDays
		} else {
			sellFSDays = existing.SellFreeStorageDays
		}
	} else {
		sellFSEnabled = false
	}

	buyFSEnabled := true
	var buyFSDays *int
	if req.BuyFreeStorageEnabled == nil || *req.BuyFreeStorageEnabled {
		buyFSEnabled = true
		if req.BuyFreeStorageDays != nil && *req.BuyFreeStorageDays > 0 {
			buyFSDays = req.BuyFreeStorageDays
		} else {
			buyFSDays = existing.BuyFreeStorageDays
		}
	} else {
		buyFSEnabled = false
	}

	// 拆单设置
	sellAllowPartial := false
	if req.SellAllowPartial != nil {
		sellAllowPartial = *req.SellAllowPartial
	}
	buyAllowPartial := false
	if req.BuyAllowPartial != nil {
		buyAllowPartial = *req.BuyAllowPartial
	}

	// 卖出腿商谈设置，默认 false
	sellAllowCounterOffer := false
	if req.SellAllowCounterOffer != nil {
		sellAllowCounterOffer = *req.SellAllowCounterOffer
	} else if req.AllowCounterOffer != nil {
		sellAllowCounterOffer = *req.AllowCounterOffer // 兼容旧字段
	}
	sellNegotiableTerms := req.SellNegotiableTerms
	if sellAllowCounterOffer {
		if len(sellNegotiableTerms) == 0 || !json.Valid(sellNegotiableTerms) {
			if len(req.NegotiableTerms) > 0 && json.Valid(req.NegotiableTerms) {
				sellNegotiableTerms = req.NegotiableTerms // 兼容旧字段
			} else {
				sellNegotiableTerms = json.RawMessage(`["price","delivery_period","payment_method","delivery_method","free_storage"]`)
			}
		}
	} else {
		sellNegotiableTerms = json.RawMessage(`[]`)
	}
	sellNegotiableTerms = sanitizeNegotiableTermsJSON(sellNegotiableTerms)

	// 买入腿商谈设置，默认 false
	buyAllowCounterOffer := false
	if req.BuyAllowCounterOffer != nil {
		buyAllowCounterOffer = *req.BuyAllowCounterOffer
	} else if req.AllowCounterOffer != nil {
		buyAllowCounterOffer = *req.AllowCounterOffer // 兼容旧字段
	}
	buyNegotiableTerms := req.BuyNegotiableTerms
	if buyAllowCounterOffer {
		if len(buyNegotiableTerms) == 0 || !json.Valid(buyNegotiableTerms) {
			if len(req.NegotiableTerms) > 0 && json.Valid(req.NegotiableTerms) {
				buyNegotiableTerms = req.NegotiableTerms // 兼容旧字段
			} else {
				buyNegotiableTerms = json.RawMessage(`["price","delivery_period","payment_method","delivery_method","free_storage"]`)
			}
		}
	} else {
		buyNegotiableTerms = json.RawMessage(`[]`)
	}
	buyNegotiableTerms = sanitizeNegotiableTermsJSON(buyNegotiableTerms)

	// 单边交易设置：默认允许，模式默认 both
	allowSingleSide := true
	if req.AllowSingleSide != nil {
		allowSingleSide = *req.AllowSingleSide
	}
	singleSideMode := "both"
	if req.SingleSideMode != "" {
		switch req.SingleSideMode {
		case "both", "single_buy", "single_sell", "none":
			singleSideMode = req.SingleSideMode
		default:
			singleSideMode = "both"
		}
	}
	if !allowSingleSide {
		singleSideMode = "none"
	}
	if singleSideMode == "none" {
		allowSingleSide = false
	}

	var expiresAt time.Time
	if req.ExpiresAt != nil && strings.TrimSpace(*req.ExpiresAt) != "" {
		t, err := ResolveExpiresAt(req.ExpiresAt, time.Now())
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		expiresAt = t
	} else if existing.ExpiresAt != nil {
		expiresAt = *existing.ExpiresAt
	} else {
		expiresAt = DefaultExpiresAt(time.Now())
	}

	startsAt, scheduled, err := ResolveStartsAt(req.StartsAt, time.Now())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	newStatus := existing.Status
	wasScheduled := existing.Status == "SCHEDULED"
	if req.StartsAt != nil {
		if scheduled {
			newStatus = "SCHEDULED"
			if !expiresAt.After(*startsAt) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "过期时间必须晚于开始时间"})
				return
			}
		} else if wasScheduled {
			newStatus = "OPEN"
			startsAt = nil
		} else {
			startsAt = existing.StartsAt
		}
	} else if wasScheduled {
		startsAt = existing.StartsAt
		if existing.StartsAt != nil && existing.StartsAt.After(time.Now()) {
			newStatus = "SCHEDULED"
		} else {
			newStatus = "OPEN"
			startsAt = nil
		}
	}

	// allowCounterOffer 是兼容字段，在 SQL 中用 ($26 OR $28) 表达式设置

	// 执行 UPDATE
	var swap SwapListing
	err = h.pool.QueryRow(ctx, `
		UPDATE swap_listings SET
			sell_product_id = $2, sell_price = $3, sell_quantity = $4,
			sell_delivery_period = $5, sell_delivery_location = $6,
			buy_product_id = $7, buy_price = $8, buy_quantity = $9,
			buy_delivery_period = $10, buy_delivery_location = $11,
			sell_allow_partial = $12, sell_min_quantity = $13,
			buy_allow_partial = $14, buy_min_quantity = $15,
			sell_payment_method = $16, buy_payment_method = $17,
			sell_delivery_method = $18, buy_delivery_method = $19,
			sell_free_storage_enabled = $20, buy_free_storage_enabled = $21,
			sell_free_storage_days = $22, buy_free_storage_days = $23,
			sell_specs = $24, buy_specs = $25,
			sell_allow_counter_offer = $26, sell_negotiable_terms = $27,
			buy_allow_counter_offer = $28, buy_negotiable_terms = $29,
			allow_counter_offer = ($26 OR $28), negotiable_terms = CASE WHEN ($26 OR $28) THEN $27 ELSE '[]'::jsonb END,
			allow_single_side = $30, single_side_mode = $31,
			remark = $32, product_id = $2,
			expires_at = $33,
			starts_at = $34,
			status = $35,
			expire_reminded_at = CASE
			  WHEN expires_at IS DISTINCT FROM $33 THEN NULL
			  ELSE expire_reminded_at
			END,
			start_reminded_at = CASE
			  WHEN starts_at IS DISTINCT FROM $34 THEN NULL
			  ELSE start_reminded_at
			END,
			updated_at = NOW()
		WHERE id = $1 AND user_id = $36 AND status IN ('OPEN','SCHEDULED')
		RETURNING id, serial_no, user_id,
		          sell_product_id, sell_price, sell_quantity, sell_filled, sell_delivery_period, sell_delivery_location,
		          buy_product_id, buy_price, buy_quantity, buy_filled, buy_delivery_period, buy_delivery_location,
		          sell_allow_partial, sell_min_quantity, buy_allow_partial, buy_min_quantity,
		          sell_payment_method, buy_payment_method,
		          sell_delivery_method, buy_delivery_method,
		          sell_free_storage_enabled, buy_free_storage_enabled,
		          sell_free_storage_days, buy_free_storage_days,
		          sell_specs, buy_specs,
		          remark, status, expires_at, starts_at, created_at, updated_at,
		          sell_allow_counter_offer, sell_negotiable_terms,
		          buy_allow_counter_offer, buy_negotiable_terms,
		          allow_counter_offer, negotiable_terms,
		          allow_single_side, single_side_mode`,
		swapID,
		req.SellProductID, req.SellPrice, req.SellQuantity, sellDP, sellDL,
		req.BuyProductID, req.BuyPrice, req.BuyQuantity, buyDP, buyDL,
		sellAllowPartial, req.SellMinQuantity,
		buyAllowPartial, req.BuyMinQuantity,
		sellPM, buyPM,
		sellDM, buyDM,
		sellFSEnabled, buyFSEnabled,
		sellFSDays, buyFSDays,
		req.SellSpecs, req.BuySpecs,
		sellAllowCounterOffer, sellNegotiableTerms,
		buyAllowCounterOffer, buyNegotiableTerms,
		allowSingleSide, singleSideMode,
		remark, expiresAt, startsAt, newStatus, userID,
	).Scan(
		&swap.ID, &swap.SerialNo, &swap.UserID,
		&swap.SellProductID, &swap.SellPrice, &swap.SellQuantity, &swap.SellFilled, &swap.SellDeliveryPeriod, &swap.SellDeliveryLocation,
		&swap.BuyProductID, &swap.BuyPrice, &swap.BuyQuantity, &swap.BuyFilled, &swap.BuyDeliveryPeriod, &swap.BuyDeliveryLocation,
		&swap.SellAllowPartial, &swap.SellMinQuantity, &swap.BuyAllowPartial, &swap.BuyMinQuantity,
		&swap.SellPaymentMethod, &swap.BuyPaymentMethod,
		&swap.SellDeliveryMethod, &swap.BuyDeliveryMethod,
		&swap.SellFreeStorageEnabled, &swap.BuyFreeStorageEnabled,
		&swap.SellFreeStorageDays, &swap.BuyFreeStorageDays,
		&swap.SellSpecs, &swap.BuySpecs,
		&swap.Remark, &swap.Status, &swap.ExpiresAt, &swap.StartsAt, &swap.CreatedAt, &swap.UpdatedAt,
		&swap.SellAllowCounterOffer, &swap.SellNegotiableTerms,
		&swap.BuyAllowCounterOffer, &swap.BuyNegotiableTerms,
		&swap.AllowCounterOffer, &swap.NegotiableTerms,
		&swap.AllowSingleSide, &swap.SingleSideMode,
	)
	if err != nil {
		log.Error().Err(err).Str("swap_id", swapID.String()).Msg("编辑换盘失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "编辑换盘失败"})
		return
	}

	if newStatus == "OPEN" && h.afterCreateMatch != nil {
		h.afterCreateMatch(c.Request.Context(), swap.ID)
	}

	// 实时推送：换盘编辑事件，让其他用户及时刷新发盘列表
	if h.listingBroadcast != nil {
		h.listingBroadcast <- engine.ListingEvent{ProductID: swap.SellProductID}
	}

	c.JSON(http.StatusOK, gin.H{"swap": swap})
}

// Cancel 撤销换盘挂牌
func (h *SwapHandler) Cancel(c *gin.Context) {
	userID := middleware.GetUserID(c)
	idStr := c.Param("id")
	swapID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的换盘 ID"})
		return
	}

	ctx := c.Request.Context()

	// 开启事务：撤盘 + 撤销关联商谈 原子执行
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "撤盘事务开启失败"})
		return
	}
	defer tx.Rollback(ctx)

	// 行锁 + 撤盘：SELECT FOR UPDATE 确保 concurrent Match/Accept 不会同时修改
	var productID string
	err = tx.QueryRow(ctx,
		`SELECT sell_product_id FROM swap_listings WHERE id = $1 AND user_id = $2 AND status IN ('OPEN','SCHEDULED') FOR UPDATE`,
		swapID, userID,
	).Scan(&productID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "换盘不存在或无法撤销（可能已被成交）"})
		return
	}

	tag, err := tx.Exec(ctx,
		`UPDATE swap_listings SET status='CANCELLED', updated_at=NOW()
		 WHERE id=$1 AND user_id=$2 AND status IN ('OPEN','SCHEDULED')`,
		swapID, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "撤销失败"})
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "换盘不存在或无法撤销（可能已被成交）"})
		return
	}

	// 在事务内撤销关联的 PENDING 商谈
	var cancelledCOCount int64
	if h.coRepo != nil {
		count, err := h.coRepo.AutoCancelPendingTx(ctx, tx, "swap", swapID, "对方已撤盘")
		if err != nil {
			log.Error().Err(err).Str("swap_id", swapID.String()).Msg("事务内撤销关联商谈失败")
		} else {
			cancelledCOCount = count
		}
	}

	if err := tx.Commit(ctx); err != nil {
		log.Error().Err(err).Str("swap_id", swapID.String()).Msg("提交换盘撤盘事务失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "撤盘提交失败"})
		return
	}

	if cancelledCOCount > 0 {
		log.Info().Int64("count", cancelledCOCount).Str("swap_id", swapID.String()).Msg("换盘撤盘自动撤销关联 PENDING 商谈")
	}

	// 实时推送：换盘撤盘事件，让其他用户及时刷新发盘列表
	if h.listingBroadcast != nil {
		h.listingBroadcast <- engine.ListingEvent{ProductID: productID}
	}

	c.JSON(http.StatusOK, gin.H{"message": "已撤销"})
}

// MatchSwapRequest 还盘请求（quantity 可选，0 或缺省表示全量匹配）
type MatchSwapRequest struct {
	Quantity     float64 `json:"quantity"`
	Mode         string  `json:"mode"`           // "sell" | "buy" | "both"
	LockMatchID  string  `json:"lock_match_id"`  // 闪拼时指定要配对的单边锁定 ID
	SellQty      float64 `json:"sell_qty"`       // both 模式下卖出侧数量（0 表示用 quantity）
	BuyQty       float64 `json:"buy_qty"`        // both 模式下买入侧数量（0 表示用 quantity）
}

// Match 接受换盘（还盘）：累加已匹配数量，支持多方还盘凑满一单；支持指定部分数量
func (h *SwapHandler) Match(c *gin.Context) {
	acceptorID := middleware.GetUserID(c)
	idStr := c.Param("id")
	swapID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的换盘 ID"})
		return
	}

	// 解析可选的数量 + 模式参数
	var req MatchSwapRequest
	_ = c.ShouldBindJSON(&req) // 忽略解析错误，quantity=0 时取全量
	mode := req.Mode
	if mode == "" {
		mode = "both" // 默认保持向后兼容
	}
	if mode != "sell" && mode != "buy" && mode != "both" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的还盘模式，可选：sell / buy / both"})
		return
	}

	ctx := c.Request.Context()

	// 查询目标换盘
	var swap SwapListing
	err = h.pool.QueryRow(ctx, `
		SELECT id, serial_no, user_id,
		       sell_product_id, sell_price, sell_quantity, sell_filled, sell_delivery_period, sell_delivery_location,
		       buy_product_id,  buy_price,  buy_quantity,  buy_filled,  buy_delivery_period,  buy_delivery_location,
		       sell_allow_partial, sell_min_quantity, buy_allow_partial, buy_min_quantity,
		       sell_payment_method, buy_payment_method,
		       sell_delivery_method, buy_delivery_method,
		       sell_free_storage_enabled, buy_free_storage_enabled,
		       sell_free_storage_days, buy_free_storage_days,
		       sell_specs, buy_specs,
		       remark, status,
		       sell_allow_counter_offer, sell_negotiable_terms,
		       buy_allow_counter_offer, buy_negotiable_terms,
		       allow_counter_offer, negotiable_terms,
		       allow_single_side, single_side_mode
		FROM swap_listings WHERE id=$1`, swapID,
	).Scan(
		&swap.ID, &swap.SerialNo, &swap.UserID,
		&swap.SellProductID, &swap.SellPrice, &swap.SellQuantity, &swap.SellFilled, &swap.SellDeliveryPeriod, &swap.SellDeliveryLocation,
		&swap.BuyProductID, &swap.BuyPrice, &swap.BuyQuantity, &swap.BuyFilled, &swap.BuyDeliveryPeriod, &swap.BuyDeliveryLocation,
		&swap.SellAllowPartial, &swap.SellMinQuantity, &swap.BuyAllowPartial, &swap.BuyMinQuantity,
		&swap.SellPaymentMethod, &swap.BuyPaymentMethod,
		&swap.SellDeliveryMethod, &swap.BuyDeliveryMethod,
		&swap.SellFreeStorageEnabled, &swap.BuyFreeStorageEnabled,
		&swap.SellFreeStorageDays, &swap.BuyFreeStorageDays,
		&swap.SellSpecs, &swap.BuySpecs,
		&swap.Remark, &swap.Status,
		&swap.SellAllowCounterOffer, &swap.SellNegotiableTerms,
		&swap.BuyAllowCounterOffer, &swap.BuyNegotiableTerms,
		&swap.AllowCounterOffer, &swap.NegotiableTerms,
		&swap.AllowSingleSide, &swap.SingleSideMode,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "换盘不存在"})
		return
	}
	if swap.UserID == acceptorID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不能接受自己的换盘"})
		return
	}

	// 黑名单检查（双向）：任一方拉黑了对方，都不能成交
	if h.blacklistRepo != nil {
		dir, _ := h.blacklistRepo.IsBlocked(ctx, acceptorID, swap.UserID)
		rev, _ := h.blacklistRepo.IsBlocked(ctx, swap.UserID, acceptorID)
		if dir || rev {
			c.JSON(http.StatusForbidden, gin.H{"error": "已拉黑该用户，无法还盘"})
			return
		}
	}

	if swap.Status != "OPEN" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该换盘已不可接受"})
		return
	}

	// 单边交易限制校验
	switch mode {
	case "sell":
		if swap.SingleSideMode == "none" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该换盘仅支持双边互换，不可单边买入"})
			return
		}
		if swap.SingleSideMode == "single_sell" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该换盘仅支持单边卖出，不可单边买入"})
			return
		}
	case "buy":
		if swap.SingleSideMode == "none" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该换盘仅支持双边互换，不可单边卖出"})
			return
		}
		if swap.SingleSideMode == "single_buy" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该换盘仅支持单边买入，不可单边卖出"})
			return
		}
	}

	// 开事务
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "操作失败"})
		return
	}
	defer tx.Rollback(ctx)

	// 计算各侧剩余量 & 当前模式下的最大可匹配量
	remainSell := swap.SellQuantity - swap.SellFilled
	remainBuy := swap.BuyQuantity - swap.BuyFilled

	// both 模式下两侧独立数量：如果前端传了 sell_qty / buy_qty，则支持两侧数量不一致
	// 按较小数量立即成交双方，多出方向创建 ACTIVE 单边锁定
	var sellQty, buyQty float64 // both 模式下两侧各自的量
	useDualQty := mode == "both" && (req.SellQty > 0 || req.BuyQty > 0)

	var maxMatchQty float64
	switch mode {
	case "sell":
		maxMatchQty = remainSell
	case "buy":
		maxMatchQty = remainBuy
	case "both":
		if useDualQty {
			// 两侧独立指定
			sellQty = req.SellQty
			buyQty = req.BuyQty
			if sellQty <= 0 {
				sellQty = remainSell
			}
			if buyQty <= 0 {
				buyQty = remainBuy
			}
			if sellQty > remainSell {
				c.JSON(http.StatusBadRequest, gin.H{"error": "卖出数量超过剩余量"})
				return
			}
			if buyQty > remainBuy {
				c.JSON(http.StatusBadRequest, gin.H{"error": "买入数量超过剩余量"})
				return
			}
			// 成交量 = min(sellQty, buyQty)
			maxMatchQty = sellQty
			if buyQty < maxMatchQty {
				maxMatchQty = buyQty
			}
		} else {
			maxMatchQty = remainSell
			if remainBuy < maxMatchQty {
				maxMatchQty = remainBuy
			}
		}
	}

	// 用户指定数量时进行校验，否则取全量
	var matchQty float64
	if useDualQty {
		matchQty = maxMatchQty // 已计算
	} else if req.Quantity > 0 {
		if req.Quantity > maxMatchQty {
			c.JSON(http.StatusBadRequest, gin.H{"error": "还盘数量超过剩余可匹配数量"})
			return
		}
		matchQty = req.Quantity
	} else {
		matchQty = maxMatchQty
	}

	// 校验拆单、最小单量及操作后剩余量
	switch mode {
	case "sell":
		if errMsg := validateSwapQtyRemain(matchQty, remainSell, swap.SellMinQuantity, swap.SellAllowPartial, "锁定"); errMsg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
			return
		}
	case "buy":
		if errMsg := validateSwapQtyRemain(matchQty, remainBuy, swap.BuyMinQuantity, swap.BuyAllowPartial, "锁定"); errMsg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
			return
		}
	case "both":
		if useDualQty {
			// 校验卖出侧
			if errMsg := validateSwapQtyRemain(sellQty, remainSell, swap.SellMinQuantity, swap.SellAllowPartial, "卖出"); errMsg != "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
				return
			}
			// 校验买入侧
			if errMsg := validateSwapQtyRemain(buyQty, remainBuy, swap.BuyMinQuantity, swap.BuyAllowPartial, "买入"); errMsg != "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
				return
			}
		} else {
			if errMsg := validateSwapQtyRemain(matchQty, remainSell, swap.SellMinQuantity, swap.SellAllowPartial, "卖出"); errMsg != "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
				return
			}
			if errMsg := validateSwapQtyRemain(matchQty, remainBuy, swap.BuyMinQuantity, swap.BuyAllowPartial, "换入"); errMsg != "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
				return
			}
		}
	}

	if matchQty <= 0 {
		// 当前模式对应方向已满
		if mode == "sell" && remainSell <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "卖出已全部匹配"})
		} else if mode == "buy" && remainBuy <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "换入已全部匹配"})
		} else {
			// 兜底修复：如果两侧都已满但 status 还是 OPEN
			if remainSell <= 0 && remainBuy <= 0 {
				_, _ = tx.Exec(ctx,
					`UPDATE swap_listings SET status = 'MATCHED', updated_at = NOW() WHERE id=$1 AND status='OPEN'`, swapID)
				_ = tx.Commit(ctx)
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": "该换盘已全部匹配"})
		}
		return
	}

	// 闪拼：配对已有单边锁定
	if req.LockMatchID != "" {
		h.matchFlash(c, ctx, tx, swap, swapID, acceptorID, mode, req.LockMatchID, matchQty, remainSell, remainBuy)
		return
	}

	isSingleSideLock := mode == "sell" || mode == "buy"

	// 根据模式决定本次更新哪些字段
	var newSellFilled, newBuyFilled float64
	switch mode {
	case "sell":
		newSellFilled = swap.SellFilled + matchQty
		newBuyFilled = swap.BuyFilled // 不变
	case "buy":
		newSellFilled = swap.SellFilled // 不变
		newBuyFilled = swap.BuyFilled + matchQty
	case "both":
		if useDualQty {
			// 两侧独立数量：成交部分 = matchQty，多出部分变为单边锁定 filled
			newSellFilled = swap.SellFilled + sellQty
			newBuyFilled = swap.BuyFilled + buyQty
		} else {
			newSellFilled = swap.SellFilled + matchQty
			newBuyFilled = swap.BuyFilled + matchQty
		}
	}

	// 换盘状态：只有两侧都完全匹配才算 MATCHED
	// WHERE status='OPEN' 防止与撤盘竞态（撤盘把 status 改为 CANCELLED 后此 UPDATE 不影响任何行）
	matchTag, err := tx.Exec(ctx,
		`UPDATE swap_listings SET
		    sell_filled = $2, buy_filled = $3,
		    status = CASE WHEN $2 >= sell_quantity AND $3 >= buy_quantity THEN 'MATCHED' ELSE 'OPEN' END,
		    updated_at = NOW()
		 WHERE id=$1 AND status = 'OPEN'`, swapID, newSellFilled, newBuyFilled)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新换盘状态失败"})
		return
	}
	if matchTag.RowsAffected() == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该换盘已被撤盘或已成交"})
		return
	}

	matchID := uuid.New()
	var lockTotalQty float64 // 单边锁合并后的总量（用于自动配对）
	if isSingleSideLock {
		var upErr error
		matchID, lockTotalQty, upErr = upsertActiveSingleLock(
			ctx, tx, swapID, acceptorID, swap.SellProductID, mode, matchQty,
		)
		if upErr != nil {
			log.Error().Err(upErr).Msg("写入/合并换盘单边锁定失败")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "写入锁定记录失败"})
			return
		}
	} else {
		_, err = tx.Exec(ctx,
			`INSERT INTO swap_matches (id, swap_a_id, swap_b_id, product_id, acceptor_id, matched_qty, matched_at, match_side, lock_status)
			 VALUES ($1, $2, NULL, $3, $4, $5, NOW(), $6, 'FLASHED')`,
			matchID, swapID, swap.SellProductID, acceptorID, matchQty, mode,
		)
		if err != nil {
			log.Error().Err(err).Msg("写入换盘匹配记录失败")
			// 匹配记录写入失败不阻断主流程
		}
	}

	// #697-4a: both 模式下两侧数量不一致时，多出方向创建/合并 ACTIVE 单边锁定记录
	var extraLockSide string // "sell" 或 "buy"，表示多出的方向
	var extraLockQty float64
	var extraLockID uuid.UUID
	var extraLockTotalQty float64
	if useDualQty && sellQty != buyQty {
		if sellQty > buyQty {
			extraLockSide = "sell"
			extraLockQty = sellQty - buyQty
		} else {
			extraLockSide = "buy"
			extraLockQty = buyQty - sellQty
		}
		var upErr error
		extraLockID, extraLockTotalQty, upErr = upsertActiveSingleLock(
			ctx, tx, swapID, acceptorID, swap.SellProductID, extraLockSide, extraLockQty,
		)
		if upErr != nil {
			log.Error().Err(upErr).Msg("写入/合并多出方向单边锁定记录失败")
		}
	}

	// #697-4b: 单边锁定创建后，检查是否存在方向相反、数量相等的 ACTIVE 锁定，自动配对成交
	// 适用场景：单边锁定(sell/buy) 或 both 模式多出方向产生的单边锁定
	var tradeRecords []*repo.Trade
	autoMatchedLockIDs := []uuid.UUID{} // 被自动配对的锁定 ID 列表

	// 收集本次 ACTIVE 锁定（合并后的总量，便于与对侧等量配对）
	type newLockInfo struct {
		id   uuid.UUID
		side string // "sell" 或 "buy"
		qty  float64
	}
	newLocks := []newLockInfo{}

	if isSingleSideLock {
		newLocks = append(newLocks, newLockInfo{id: matchID, side: mode, qty: lockTotalQty})
	}
	if extraLockSide != "" && extraLockQty > 0 && extraLockID != uuid.Nil {
		qty := extraLockTotalQty
		if qty <= 0 {
			qty = extraLockQty
		}
		newLocks = append(newLocks, newLockInfo{id: extraLockID, side: extraLockSide, qty: qty})
	}

	// 对每个新锁定，检查是否有方向相反、数量相等的其他 ACTIVE 锁定
	// 优先配对第三方锁（计入行情）；若无，则允许与本人反侧锁配对（双方换盘，不计入行情）
	for _, nl := range newLocks {
		oppositeSide := "buy"
		if nl.side == "buy" {
			oppositeSide = "sell"
		}
		var oppLockID uuid.UUID
		var oppAcceptorID uuid.UUID
		var oppQty float64
		err = tx.QueryRow(ctx,
			`SELECT id, acceptor_id, matched_qty FROM swap_matches
			 WHERE swap_a_id = $1 AND lock_status = 'ACTIVE' AND match_side = $2
			   AND id != $3
			 ORDER BY CASE WHEN acceptor_id = $4 THEN 1 ELSE 0 END, matched_at ASC
			 LIMIT 1`,
			swapID, oppositeSide, nl.id, acceptorID,
		).Scan(&oppLockID, &oppAcceptorID, &oppQty)
		if err != nil {
			continue // 没有找到配对
		}
		if oppQty == nl.qty {
			// 数量相等 → 自动配对成交
			autoMatchedLockIDs = append(autoMatchedLockIDs, nl.id, oppLockID)
			isSelfPair := oppAcceptorID == acceptorID
			legSource := repo.TradeSourceSwap
			if isSelfPair {
				legSource = repo.TradeSourceSwapPrivate
			}

			// 将两条锁定记录标记为 FLASHED
			_, _ = tx.Exec(ctx, `UPDATE swap_matches SET lock_status = 'FLASHED' WHERE id IN ($1, $2)`, nl.id, oppLockID)

			// 生成 trade 记录
			if h.tradeRepo != nil {
				serial := swap.SerialNo
				// sell 方向的 trade: 发起方(卖方) → 锁定方(买方)
				// buy 方向的 trade: 锁定方(卖方) → 发起方(买方)
				buildAutoLeg := func(leg string) *repo.Trade {
					var (
						productID          string
						price              float64
						deliveryPeriod     *string
						deliveryLocation   *string
						buyerID, sellerID  uuid.UUID
						paymentMethod      *string
						deliveryMethod     *string
						freeStorageEnabled *bool
						freeStorageDays    *int
						specs              json.RawMessage
					)
					if leg == "sell" {
						productID = swap.SellProductID
						price = swap.SellPrice
						deliveryPeriod = swap.SellDeliveryPeriod
						deliveryLocation = swap.SellDeliveryLocation
						// sell 锁定方是买方：如果本次新锁定是 sell 方向，则当前用户是买方
						if nl.side == "sell" {
							buyerID = acceptorID
						} else {
							buyerID = oppAcceptorID
						}
						sellerID = swap.UserID
						paymentMethod = swap.SellPaymentMethod
						deliveryMethod = swap.SellDeliveryMethod
						freeStorageEnabled = &swap.SellFreeStorageEnabled
						freeStorageDays = swap.SellFreeStorageDays
						specs = swap.SellSpecs
					} else {
						productID = swap.BuyProductID
						price = swap.BuyPrice
						deliveryPeriod = swap.BuyDeliveryPeriod
						deliveryLocation = swap.BuyDeliveryLocation
						buyerID = swap.UserID
						// buy 锁定方是卖方：如果本次新锁定是 buy 方向，则当前用户是卖方
						if nl.side == "buy" {
							sellerID = acceptorID
						} else {
							sellerID = oppAcceptorID
						}
						paymentMethod = swap.BuyPaymentMethod
						deliveryMethod = swap.BuyDeliveryMethod
						freeStorageEnabled = &swap.BuyFreeStorageEnabled
						freeStorageDays = swap.BuyFreeStorageDays
						specs = swap.BuySpecs
					}
					return &repo.Trade{
						ProductID:          productID,
						BuyOrderID:         nl.id,
						SellOrderID:        swapID,
						BuyUserID:          buyerID,
						SellUserID:         sellerID,
						Price:              price,
						Quantity:           nl.qty,
						DeliveryPeriod:     deliveryPeriod,
						DeliveryLocation:   deliveryLocation,
						BuySerialNo:        &serial,
						SellSerialNo:       &serial,
						BuyPaymentMethod:   paymentMethod,
						SellPaymentMethod:  paymentMethod,
						DeliveryMethod:     deliveryMethod,
						FreeStorageEnabled: freeStorageEnabled,
						FreeStorageDays:    freeStorageDays,
						BuySpecs:           specs,
						SellSpecs:          specs,
						Source:             legSource,
						AggressorUserID:    &acceptorID,
					}
				}
				autoTrade1 := buildAutoLeg("sell")
				autoTrade2 := buildAutoLeg("buy")
				tradeRecords = append(tradeRecords, autoTrade1, autoTrade2)
			}

			// 通知被配对的锁定方（本人自配对无需推送）
			if !isSelfPair {
				h.pushSwapLockEvent(oppAcceptorID, "swap_lock_matched", swap, oppLockID, oppositeSide, oppQty)
			}

			break // 只配对一次
		}
	}

	// #697-6 方向一: 换盘锁单 → 普通挂牌自动撮合
	// 对 newLocks 中未被 #697-4b 配对的 ACTIVE 锁定，查询 listings 表方向相反、条款完全匹配的 OPEN/PARTIAL 挂牌
	for _, nl := range newLocks {
		// 跳过已被 #697-4b 配对的锁单
		alreadyMatched := false
		for _, mID := range autoMatchedLockIDs {
			if nl.id == mID {
				alreadyMatched = true
				break
			}
		}
		if alreadyMatched {
			continue
		}

		// 根据锁定的 side 确定 swap_listings 的对应腿字段
		// 锁定 sell → 发牌方卖出该腿，锁定方是买方 → 需要找 SELL 挂牌（卖方=挂牌方）
		// 锁定 buy → 发牌方买入该腿，锁定方是卖方 → 需要找 BUY 挂盘（买方=挂牌方）
		var (
			legProductID        string
			legPrice            float64
			legDeliveryPeriod   *string
			legDeliveryLocation *string
			legPaymentMethod    *string
			legDeliveryMethod   *string
			legFreeStorageEn    bool
			legFreeStorageDays  *int
			legSpecs            json.RawMessage
			listingSide         string // 需要匹配的挂牌方向
		)
		if nl.side == "sell" {
			// sell 锁定：发牌方卖，锁定方买 → 找 SELL 挂牌
			legProductID = swap.SellProductID
			legPrice = swap.SellPrice
			legDeliveryPeriod = swap.SellDeliveryPeriod
			legDeliveryLocation = swap.SellDeliveryLocation
			legPaymentMethod = swap.SellPaymentMethod
			legDeliveryMethod = swap.SellDeliveryMethod
			legFreeStorageEn = swap.SellFreeStorageEnabled
			legFreeStorageDays = swap.SellFreeStorageDays
			legSpecs = swap.SellSpecs
			listingSide = "sell"
		} else {
			// buy 锁定：发牌方买，锁定方卖 → 找 BUY 挂盘
			legProductID = swap.BuyProductID
			legPrice = swap.BuyPrice
			legDeliveryPeriod = swap.BuyDeliveryPeriod
			legDeliveryLocation = swap.BuyDeliveryLocation
			legPaymentMethod = swap.BuyPaymentMethod
			legDeliveryMethod = swap.BuyDeliveryMethod
			legFreeStorageEn = swap.BuyFreeStorageEnabled
			legFreeStorageDays = swap.BuyFreeStorageDays
			legSpecs = swap.BuySpecs
			listingSide = "buy"
		}

		// 查询 listings 表中方向相反、条款完全匹配的 OPEN/PARTIAL 挂牌
		// 条件：product_id 相同、side 相同（锁定 sell→找 sell 挂牌，锁定方为买方）、price 相同、
		//       数量足够（quantity - filled >= 锁定数量）、交割期/交割方式/免仓期一致、不同用户
		var (
			matchListingID uuid.UUID
			matchUserID    uuid.UUID
			matchSerialNo  int64
			matchSpecs     json.RawMessage
		)
		err = tx.QueryRow(ctx,
			`SELECT id, user_id, serial_no, specs FROM listings
			 WHERE product_id = $1 AND side = $2 AND price = $3
			   AND status IN ('OPEN','PARTIAL')
			   AND (quantity - filled) >= $4
			   AND user_id != $5
			   AND delivery_period IS NOT DISTINCT FROM $6
			   AND delivery_location IS NOT DISTINCT FROM $7
			   AND payment_method IS NOT DISTINCT FROM $8
			   AND delivery_method IS NOT DISTINCT FROM $9
			   AND free_storage_enabled = $10
			   AND free_storage_days IS NOT DISTINCT FROM $11
			 ORDER BY created_at ASC LIMIT 1`,
			legProductID, listingSide, legPrice, nl.qty, acceptorID,
			legDeliveryPeriod, legDeliveryLocation, legPaymentMethod, legDeliveryMethod,
			legFreeStorageEn, legFreeStorageDays,
		).Scan(&matchListingID, &matchUserID, &matchSerialNo, &matchSpecs)
		if err != nil {
			continue // 没有找到匹配的挂牌
		}

		// 黑名单检查
		if h.blacklistRepo != nil {
			blocked, _ := h.blacklistRepo.IsBlocked(ctx, matchUserID, acceptorID)
			if blocked {
				continue
			}
			blocked2, _ := h.blacklistRepo.IsBlocked(ctx, acceptorID, matchUserID)
			if blocked2 {
				continue
			}
		}

		// 匹配成功 → 更新锁单状态为 FLASHED
		_, _ = tx.Exec(ctx, `UPDATE swap_matches SET lock_status = 'FLASHED' WHERE id = $1`, nl.id)

		// 更新挂牌已成交量
		if h.listingRepo != nil {
			if err := h.listingRepo.AddFilledTx(ctx, tx, matchListingID, nl.qty); err != nil {
				log.Error().Err(err).Str("listing_id", matchListingID.String()).Msg("#697-6 更新挂牌已成交量失败")
				continue
			}
		}

		// 生成 trade 记录
		if h.tradeRepo != nil {
			serial := swap.SerialNo
			var (
				buyerID, sellerID uuid.UUID
				buySerialNo       *int64
				sellSerialNo      *int64
				buySpecs          json.RawMessage
				sellSpecs         json.RawMessage
			)
			if nl.side == "sell" {
				// sell 锁定：锁定方(acceptorID)是买方，挂牌方(matchUserID)是卖方
				buyerID = acceptorID
				sellerID = matchUserID
				buySerialNo = &serial
				sellSerialNo = &matchSerialNo
				buySpecs = legSpecs
				sellSpecs = matchSpecs
			} else {
				// buy 锁定：挂牌方(matchUserID)是买方，锁定方(acceptorID)是卖方
				buyerID = matchUserID
				sellerID = acceptorID
				buySerialNo = &matchSerialNo
				sellSerialNo = &serial
				buySpecs = matchSpecs
				sellSpecs = legSpecs
			}
			crossTrade := &repo.Trade{
				ProductID:          legProductID,
				BuyOrderID:         matchListingID, // 普通挂牌 ID
				SellOrderID:        swapID,         // 换盘挂牌 ID
				BuyUserID:          buyerID,
				SellUserID:         sellerID,
				Price:              legPrice,
				Quantity:           nl.qty,
				DeliveryPeriod:     legDeliveryPeriod,
				DeliveryLocation:   legDeliveryLocation,
				BuySerialNo:        buySerialNo,
				SellSerialNo:       sellSerialNo,
				BuyPaymentMethod:   legPaymentMethod,
				SellPaymentMethod:  legPaymentMethod,
				DeliveryMethod:     legDeliveryMethod,
				FreeStorageEnabled: &legFreeStorageEn,
				FreeStorageDays:    legFreeStorageDays,
				BuySpecs:           buySpecs,
				SellSpecs:          sellSpecs,
				Source:             "swap",
				AggressorUserID:    &acceptorID,
				NotifyListingUserID: &matchUserID,
			}
			tradeRecords = append(tradeRecords, crossTrade)
		}

		// 通知挂牌方：您的挂牌已被换盘锁单撮合
		if h.wsPush != nil {
			h.wsPush(matchUserID, "listing_matched_by_swap", map[string]interface{}{
				"swap_id":       swapID,
				"listing_id":    matchListingID,
				"match_qty":     nl.qty,
				"match_side":    nl.side,
				"product_id":    legProductID,
			})
		}

		// 标记此锁单已被撮合（加入 autoMatchedLockIDs 避免重复处理）
		autoMatchedLockIDs = append(autoMatchedLockIDs, nl.id)

		log.Info().
			Str("swap_id", swapID.String()).
			Str("lock_id", nl.id.String()).
			Str("listing_id", matchListingID.String()).
			Str("side", nl.side).
			Float64("qty", nl.qty).
			Msg("#697-6 换盘锁单与普通挂牌自动撮合成功")
	}

	// 换盘成交记录：双向摘盘或闪拼完成时写入；单边锁定不生成（但 #697-4b 自动配对的 trade 已追加到 tradeRecords）
	if h.tradeRepo != nil && !isSingleSideLock {
		// buildLeg 根据换盘某条腿构造成交记录
		buildLeg := func(leg string) *repo.Trade {
			var (
				productID          string
				price              float64
				deliveryPeriod     *string
				deliveryLocation   *string
				buyerID, sellerID  uuid.UUID
				paymentMethod      *string
				deliveryMethod     *string
				freeStorageEnabled *bool
				freeStorageDays    *int
				specs              json.RawMessage
			)
			serial := swap.SerialNo
			if leg == "sell" {
				// 单买：对手方接受卖腿 → 发起方(卖方) 出货给接受方(买方)
				productID = swap.SellProductID
				price = swap.SellPrice
				deliveryPeriod = swap.SellDeliveryPeriod
				deliveryLocation = swap.SellDeliveryLocation
				buyerID = acceptorID
				sellerID = swap.UserID
				paymentMethod = swap.SellPaymentMethod
				deliveryMethod = swap.SellDeliveryMethod
				freeStorageEnabled = &swap.SellFreeStorageEnabled
				freeStorageDays = swap.SellFreeStorageDays
				specs = swap.SellSpecs
			} else {
				// 单卖：对手方接受买腿 → 发起方(买方) 从接受方(卖方) 进货
				productID = swap.BuyProductID
				price = swap.BuyPrice
				deliveryPeriod = swap.BuyDeliveryPeriod
				deliveryLocation = swap.BuyDeliveryLocation
				buyerID = swap.UserID
				sellerID = acceptorID
				paymentMethod = swap.BuyPaymentMethod
				deliveryMethod = swap.BuyDeliveryMethod
				freeStorageEnabled = &swap.BuyFreeStorageEnabled
				freeStorageDays = swap.BuyFreeStorageDays
				specs = swap.BuySpecs
			}
			return &repo.Trade{
				ProductID:          productID,
				BuyOrderID:         matchID, // 换盘没有普通挂牌 ID，用 matchID 作为关联
				SellOrderID:        swapID,  // 换盘挂牌 ID
				BuyUserID:          buyerID,
				SellUserID:         sellerID,
				Price:              price,
				Quantity:           matchQty,
				DeliveryPeriod:     deliveryPeriod,
				DeliveryLocation:   deliveryLocation,
				BuySerialNo:        &serial,
				SellSerialNo:       &serial,
				BuyPaymentMethod:   paymentMethod,
				SellPaymentMethod:  paymentMethod,
				DeliveryMethod:     deliveryMethod,
				FreeStorageEnabled: freeStorageEnabled,
				FreeStorageDays:    freeStorageDays,
				BuySpecs:           specs,
				SellSpecs:          specs,
				// 双方换盘（同一接受方吃买卖两腿）无市场参考意义，不计入行情
				Source:          repo.TradeSourceSwapPrivate,
				AggressorUserID: &acceptorID,
			}
		}

		switch mode {
		case "sell":
			tradeRecords = append(tradeRecords, buildLeg("sell"))
		case "buy":
			tradeRecords = append(tradeRecords, buildLeg("buy"))
		case "both":
			tradeRecords = append(tradeRecords, buildLeg("sell"), buildLeg("buy"))
		}
	}

	// 统一写入所有 trade 记录（包括 #697-4b 自动配对产生的）
	if h.tradeRepo != nil {
		for _, tr := range tradeRecords {
			if err := h.tradeRepo.CreateTx(ctx, tx, tr); err != nil {
				log.Error().Err(err).Msg("写入换盘成交记录失败（不影响换盘主流程）")
				tr.ID = uuid.Nil
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "提交失败"})
		return
	}

	// 单边锁定后，对侧剩余腿仍可与同条款挂牌自动撮合
	if h.afterCreateMatch != nil {
		h.afterCreateMatch(ctx, swapID)
	}

	// 单边锁定通知发牌方
	if isSingleSideLock {
		h.pushSwapLockEvent(swap.UserID, "swap_lock_received", swap, matchID, mode, matchQty)
	}
	// #697-4a: both 模式下多出方向的单边锁定也要通知发牌方
	if extraLockSide != "" && extraLockQty > 0 && extraLockID != uuid.Nil {
		h.pushSwapLockEvent(swap.UserID, "swap_lock_received", swap, extraLockID, extraLockSide, extraLockQty)
	}

	if h.listingBroadcast != nil {
		h.listingBroadcast <- engine.ListingEvent{ProductID: swap.SellProductID}
	}

	// 推送成交：行情广播；双方换盘点对点通知被动方
	h.pushTradeNotifications(tradeRecords)

	// 换盘完全匹配后，自动撤销关联的 PENDING 议价
	isMatched := newSellFilled >= swap.SellQuantity && newBuyFilled >= swap.BuyQuantity
	if isMatched && h.coRepo != nil {
		count, err := h.coRepo.AutoCancelPending(ctx, "swap", swapID, "对方已成交")
		if err != nil {
			log.Error().Err(err).Str("swap_id", swapID.String()).Msg("换盘成交自动撤销关联议价失败")
		} else if count > 0 {
			log.Info().Int64("count", count).Str("swap_id", swapID.String()).Msg("换盘成交自动撤销关联 PENDING 议价")
		}
	}

	msg := "换盘成功"

	marketPrice := false
	for _, tr := range tradeRecords {
		if tr.Source != repo.TradeSourceSwapPrivate {
			marketPrice = true
			break
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message":             msg,
		"match_id":            matchID,
		"match_side":          mode,
		"sell_filled":         newSellFilled,
		"buy_filled":          newBuyFilled,
		// 纯单边锁定且未完成配对/三方：is_lock=true（不算成交价）
		"is_lock":             isSingleSideLock && len(tradeRecords) == 0,
		"market_price":        marketPrice,
		"extra_lock_side":     extraLockSide,
		"extra_lock_qty":      extraLockQty,
	})
}

// matchFlash 闪拼：配对已有单边锁定，完成指定数量的双向成交
func (h *SwapHandler) matchFlash(
	c *gin.Context,
	ctx context.Context,
	tx pgx.Tx,
	swap SwapListing,
	swapID, acceptorID uuid.UUID,
	mode, lockMatchIDStr string,
	matchQty, remainSell, remainBuy float64,
) {
	if mode != "sell" && mode != "buy" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "闪拼仅支持单边模式"})
		return
	}
	if matchQty <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请指定闪拼数量"})
		return
	}

	lockMatchID, err := uuid.Parse(lockMatchIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的锁定 ID"})
		return
	}

	expectedLockSide := "sell"
	if mode == "sell" {
		expectedLockSide = "buy"
	}

	var lockQty float64
	var lockSide string
	var lockAcceptorID uuid.UUID
	err = tx.QueryRow(ctx,
		`SELECT matched_qty, match_side, acceptor_id FROM swap_matches
		 WHERE id=$1 AND swap_a_id=$2 AND lock_status='ACTIVE' AND match_side=$3`,
		lockMatchID, swapID, expectedLockSide,
	).Scan(&lockQty, &lockSide, &lockAcceptorID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未找到可拼单的单边锁定"})
		return
	}
	if matchQty > lockQty {
		c.JSON(http.StatusBadRequest, gin.H{"error": "闪拼数量不能超过所选锁定量"})
		return
	}
	// 与本人反侧锁定闪拼 = 双方换盘（同人吃两腿），不计入行情
	isSelfFlash := lockAcceptorID == acceptorID
	flashSource := repo.TradeSourceSwap
	if isSelfFlash {
		flashSource = repo.TradeSourceSwapPrivate
	}

	// 校验闪拼侧剩余量与最小单量
	var allowPartial bool
	var minQty, remain float64
	if mode == "sell" {
		allowPartial = swap.SellAllowPartial
		minQty = swap.SellMinQuantity
		remain = remainSell
	} else {
		allowPartial = swap.BuyAllowPartial
		minQty = swap.BuyMinQuantity
		remain = remainBuy
	}
	if errMsg := validateSwapQtyRemain(matchQty, remain, minQty, allowPartial, "闪拼"); errMsg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
		return
	}

	var newSellFilled, newBuyFilled float64
	switch mode {
	case "sell":
		newSellFilled = swap.SellFilled + matchQty
		newBuyFilled = swap.BuyFilled
	case "buy":
		newSellFilled = swap.SellFilled
		newBuyFilled = swap.BuyFilled + matchQty
	}

	// 部分闪拼：未配对部分从锁定侧 filled 中释放
	if matchQty < lockQty {
		switch expectedLockSide {
		case "sell":
			newSellFilled -= (lockQty - matchQty)
		case "buy":
			newBuyFilled -= (lockQty - matchQty)
		}
	}

	matchTag, err := tx.Exec(ctx,
		`UPDATE swap_listings SET
		    sell_filled = $2, buy_filled = $3,
		    status = CASE WHEN $2 >= sell_quantity AND $3 >= buy_quantity THEN 'MATCHED' ELSE 'OPEN' END,
		    updated_at = NOW()
		 WHERE id=$1 AND status = 'OPEN'`, swapID, newSellFilled, newBuyFilled)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新换盘状态失败"})
		return
	}
	if matchTag.RowsAffected() == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该换盘已被撤盘或已成交"})
		return
	}

	if matchQty >= lockQty {
		_, _ = tx.Exec(ctx, `UPDATE swap_matches SET lock_status='FLASHED' WHERE id=$1`, lockMatchID)
	} else {
		_, _ = tx.Exec(ctx,
			`UPDATE swap_matches SET matched_qty = matched_qty - $2 WHERE id=$1`,
			lockMatchID, matchQty)
	}

	flashMatchID := uuid.New()
	_, _ = tx.Exec(ctx,
		`INSERT INTO swap_matches (id, swap_a_id, swap_b_id, product_id, acceptor_id, matched_qty, matched_at, match_side, lock_status)
		 VALUES ($1, $2, NULL, $3, $4, $5, NOW(), $6, 'FLASHED')`,
		flashMatchID, swapID, swap.SellProductID, acceptorID, matchQty, mode,
	)

	var tradeRecords []*repo.Trade
	if h.tradeRepo != nil {
		// 卖腿买方 / 买腿卖方：闪拼方吃一侧，原锁定方吃另一侧（与 #697-4b 自动配对一致）
		sellLegBuyer := lockAcceptorID
		buyLegSeller := lockAcceptorID
		if mode == "sell" {
			sellLegBuyer = acceptorID
		} else {
			buyLegSeller = acceptorID
		}
		buildLeg := func(leg string) *repo.Trade {
			var (
				productID          string
				price              float64
				deliveryPeriod     *string
				deliveryLocation   *string
				buyerID, sellerID  uuid.UUID
				paymentMethod      *string
				deliveryMethod     *string
				freeStorageEnabled *bool
				freeStorageDays    *int
				specs              json.RawMessage
			)
			serial := swap.SerialNo
			if leg == "sell" {
				productID = swap.SellProductID
				price = swap.SellPrice
				deliveryPeriod = swap.SellDeliveryPeriod
				deliveryLocation = swap.SellDeliveryLocation
				buyerID = sellLegBuyer
				sellerID = swap.UserID
				paymentMethod = swap.SellPaymentMethod
				deliveryMethod = swap.SellDeliveryMethod
				freeStorageEnabled = &swap.SellFreeStorageEnabled
				freeStorageDays = swap.SellFreeStorageDays
				specs = swap.SellSpecs
			} else {
				productID = swap.BuyProductID
				price = swap.BuyPrice
				deliveryPeriod = swap.BuyDeliveryPeriod
				deliveryLocation = swap.BuyDeliveryLocation
				buyerID = swap.UserID
				sellerID = buyLegSeller
				paymentMethod = swap.BuyPaymentMethod
				deliveryMethod = swap.BuyDeliveryMethod
				freeStorageEnabled = &swap.BuyFreeStorageEnabled
				freeStorageDays = swap.BuyFreeStorageDays
				specs = swap.BuySpecs
			}
			return &repo.Trade{
				ProductID:          productID,
				BuyOrderID:         flashMatchID,
				SellOrderID:        swapID,
				BuyUserID:          buyerID,
				SellUserID:         sellerID,
				Price:              price,
				Quantity:           matchQty,
				DeliveryPeriod:     deliveryPeriod,
				DeliveryLocation:   deliveryLocation,
				BuySerialNo:        &serial,
				SellSerialNo:       &serial,
				BuyPaymentMethod:   paymentMethod,
				SellPaymentMethod:  paymentMethod,
				DeliveryMethod:     deliveryMethod,
				FreeStorageEnabled: freeStorageEnabled,
				FreeStorageDays:    freeStorageDays,
				BuySpecs:           specs,
				SellSpecs:          specs,
				Source:             flashSource,
				AggressorUserID:    &acceptorID,
			}
		}
		tradeRecords = append(tradeRecords, buildLeg("sell"), buildLeg("buy"))
		for _, tr := range tradeRecords {
			if err := h.tradeRepo.CreateTx(ctx, tx, tr); err != nil {
				log.Error().Err(err).Msg("写入闪拼成交记录失败")
				tr.ID = uuid.Nil
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "提交失败"})
		return
	}

	if h.listingBroadcast != nil {
		h.listingBroadcast <- engine.ListingEvent{ProductID: swap.SellProductID}
	}
	h.pushTradeNotifications(tradeRecords)

	isMatched := newSellFilled >= swap.SellQuantity && newBuyFilled >= swap.BuyQuantity
	if isMatched && h.coRepo != nil {
		_, _ = h.coRepo.AutoCancelPending(ctx, "swap", swapID, "对方已成交")
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      "换盘成功",
		"match_id":     flashMatchID,
		"match_side":   mode,
		"sell_filled":  newSellFilled,
		"buy_filled":   newBuyFilled,
		"is_flash":     true,
		"market_price": !isSelfFlash,
	})
}

// ListMyLocks 我的换盘单边锁定
func (h *SwapHandler) ListMyLocks(c *gin.Context) {
	userID := middleware.GetUserID(c)
	ctx := c.Request.Context()

	rows, err := h.pool.Query(ctx, `
		SELECT sm.id, sm.swap_a_id, sl.serial_no, sm.match_side, sm.matched_qty, sm.matched_at
		FROM swap_matches sm
		JOIN swap_listings sl ON sl.id = sm.swap_a_id
		WHERE sm.acceptor_id = $1 AND sm.lock_status = 'ACTIVE'
		  AND sm.match_side IN ('sell', 'buy')
		ORDER BY sm.matched_at DESC
		LIMIT 100`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	defer rows.Close()

	type lockRow struct {
		ID         uuid.UUID `json:"id"`
		SwapID     uuid.UUID `json:"swap_id"`
		SerialNo   int64     `json:"serial_no"`
		MatchSide  string    `json:"match_side"`
		MatchedQty float64   `json:"matched_qty"`
		MatchedAt  time.Time `json:"matched_at"`
	}
	data := make([]lockRow, 0)
	for rows.Next() {
		var r lockRow
		if err := rows.Scan(&r.ID, &r.SwapID, &r.SerialNo, &r.MatchSide, &r.MatchedQty, &r.MatchedAt); err != nil {
			continue
		}
		data = append(data, r)
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

// ListPendingLocks 待拼单的单边锁定（mode 为闪拼侧：sell/buy）
func (h *SwapHandler) ListPendingLocks(c *gin.Context) {
	swapID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的换盘 ID"})
		return
	}
	mode := c.Query("mode")
	if mode != "sell" && mode != "buy" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "mode 须为 sell 或 buy"})
		return
	}
	lockSide := "sell"
	if mode == "sell" {
		lockSide = "buy"
	}

	ctx := c.Request.Context()
	// 闪拼不返回公司名/用户名，避免泄露对手方身份
	rows, err := h.pool.Query(ctx, `
		SELECT sm.id, sm.match_side, sm.matched_qty, sm.matched_at, sm.acceptor_id
		FROM swap_matches sm
		WHERE sm.swap_a_id = $1 AND sm.lock_status = 'ACTIVE' AND sm.match_side = $2
		ORDER BY CASE WHEN sm.acceptor_id = $3 THEN 1 ELSE 0 END, sm.matched_at ASC`,
		swapID, lockSide, middleware.GetUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	defer rows.Close()

	type pendingRow struct {
		ID           uuid.UUID `json:"id"`
		MatchSide    string    `json:"match_side"`
		MatchedQty   float64   `json:"matched_qty"`
		MatchedAt    time.Time `json:"matched_at"`
		AcceptorID   uuid.UUID `json:"acceptor_id"`
		AcceptorName string    `json:"acceptor_name"` // 匿名展示名，不含公司/用户名
	}
	data := make([]pendingRow, 0)
	idx := 0
	for rows.Next() {
		var r pendingRow
		if err := rows.Scan(&r.ID, &r.MatchSide, &r.MatchedQty, &r.MatchedAt, &r.AcceptorID); err != nil {
			continue
		}
		idx++
		r.AcceptorName = fmt.Sprintf("锁定方#%d", idx)
		data = append(data, r)
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

// CancelLock 取消单边锁定（仅锁定方本人）
func (h *SwapHandler) CancelLock(c *gin.Context) {
	userID := middleware.GetUserID(c)
	matchID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的匹配 ID"})
		return
	}
	ctx := c.Request.Context()

	var swapID uuid.UUID
	var matchSide string
	var matchedQty float64
	var swapOwner uuid.UUID
	var serialNo int64
	err = h.pool.QueryRow(ctx, `
		SELECT sm.swap_a_id, sm.match_side, sm.matched_qty, sl.user_id, sl.serial_no
		FROM swap_matches sm
		JOIN swap_listings sl ON sl.id = sm.swap_a_id
		WHERE sm.id = $1 AND sm.acceptor_id = $2 AND sm.lock_status = 'ACTIVE'
		  AND sm.match_side IN ('sell', 'buy')`,
		matchID, userID,
	).Scan(&swapID, &matchSide, &matchedQty, &swapOwner, &serialNo)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "未找到可取消的锁定"})
		return
	}

	tx, err := h.pool.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "操作失败"})
		return
	}
	defer tx.Rollback(ctx)

	var sellFilled, buyFilled float64
	err = tx.QueryRow(ctx,
		`SELECT sell_filled, buy_filled FROM swap_listings WHERE id=$1 AND status='OPEN' FOR UPDATE`,
		swapID,
	).Scan(&sellFilled, &buyFilled)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "换盘已不可操作"})
		return
	}

	switch matchSide {
	case "sell":
		sellFilled -= matchedQty
		if sellFilled < 0 {
			sellFilled = 0
		}
	case "buy":
		buyFilled -= matchedQty
		if buyFilled < 0 {
			buyFilled = 0
		}
	}

	_, err = tx.Exec(ctx,
		`UPDATE swap_listings SET sell_filled=$2, buy_filled=$3, updated_at=NOW() WHERE id=$1`,
		swapID, sellFilled, buyFilled)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新换盘失败"})
		return
	}

	_, err = tx.Exec(ctx, `UPDATE swap_matches SET lock_status='CANCELLED' WHERE id=$1`, matchID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "取消锁定失败"})
		return
	}

	// 清理历史单边锁定误写的成交记录
	_, _ = tx.Exec(ctx, `DELETE FROM trades WHERE buy_order_id=$1 AND source IN ('swap', 'swap_private')`, matchID)

	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "提交失败"})
		return
	}

	h.pushSwapLockEvent(swapOwner, "swap_lock_cancelled", SwapListing{
		ID: swapID, SerialNo: serialNo, UserID: swapOwner,
	}, matchID, matchSide, matchedQty)

	if h.listingBroadcast != nil {
		var productID string
		_ = h.pool.QueryRow(ctx, `SELECT sell_product_id FROM swap_listings WHERE id=$1`, swapID).Scan(&productID)
		if productID != "" {
			h.listingBroadcast <- engine.ListingEvent{ProductID: productID}
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "已取消锁定"})
}

func validateSwapQtyRemain(qty, remain, minQty float64, allowPartial bool, label string) string {
	if qty <= 0 {
		return label + "数量须大于 0"
	}
	if qty > remain {
		return fmt.Sprintf("%s数量不能超过剩余量 %.0f", label, remain)
	}
	if !allowPartial && qty < remain {
		return label + "不可拆单，须全量操作"
	}
	effectiveMin := minQty
	if effectiveMin <= 0 {
		effectiveMin = 1
	}
	// 剩余量不足再保留一个最小单量（含尾量不足最小单量）：只能全部锁定
	if remain < effectiveMin*2 {
		if qty != remain {
			return fmt.Sprintf("%s剩余量 %.0f 不足再保留最小单量 %.0f，须全部锁定 %.0f", label, remain, effectiveMin, remain)
		}
		return ""
	}
	if qty < effectiveMin {
		return fmt.Sprintf("%s数量不能小于最小单量 %.0f", label, effectiveMin)
	}
	// 按份数：部分操作时数量须为每份整数倍；全部锁定剩余量时放行
	if allowPartial && minQty > 0 && qty != remain {
		qi, mi := int64(qty), int64(effectiveMin)
		if mi > 0 && qi%mi != 0 {
			return fmt.Sprintf("%s数量须为每份 %.0f 的整数倍", label, effectiveMin)
		}
	}
	after := remain - qty
	if after > 0 && after < effectiveMin {
		return fmt.Sprintf("%s后剩余量须为 0 或 ≥ 最小单量 %.0f（当前仅能全部锁定 %.0f）", label, effectiveMin, remain)
	}
	return ""
}

func swapLockSideLabel(matchSide string) string {
	if matchSide == "buy" {
		return "买入"
	}
	return "卖出"
}

// upsertActiveSingleLock 同用户同换盘同方向的 ACTIVE 锁合并为一条（数量累加），避免重复锁记录与多次解锁按钮。
// 返回合并后的锁定 ID 与总数量。
func upsertActiveSingleLock(
	ctx context.Context,
	tx pgx.Tx,
	swapID, acceptorID uuid.UUID,
	productID, matchSide string,
	addQty float64,
) (lockID uuid.UUID, totalQty float64, err error) {
	if addQty <= 0 {
		return uuid.Nil, 0, fmt.Errorf("锁定量无效")
	}

	rows, err := tx.Query(ctx,
		`SELECT id, matched_qty FROM swap_matches
		 WHERE swap_a_id = $1 AND acceptor_id = $2 AND match_side = $3 AND lock_status = 'ACTIVE'
		 ORDER BY matched_at ASC
		 FOR UPDATE`,
		swapID, acceptorID, matchSide,
	)
	if err != nil {
		return uuid.Nil, 0, err
	}
	defer rows.Close()

	type existing struct {
		id  uuid.UUID
		qty float64
	}
	var found []existing
	for rows.Next() {
		var e existing
		if scanErr := rows.Scan(&e.id, &e.qty); scanErr != nil {
			return uuid.Nil, 0, scanErr
		}
		found = append(found, e)
	}
	if err := rows.Err(); err != nil {
		return uuid.Nil, 0, err
	}

	if len(found) == 0 {
		lockID = uuid.New()
		_, err = tx.Exec(ctx,
			`INSERT INTO swap_matches (id, swap_a_id, swap_b_id, product_id, acceptor_id, matched_qty, matched_at, match_side, lock_status)
			 VALUES ($1, $2, NULL, $3, $4, $5, NOW(), $6, 'ACTIVE')`,
			lockID, swapID, productID, acceptorID, addQty, matchSide,
		)
		return lockID, addQty, err
	}

	// 保留最早一条，把本次增量与其余重复记录数量合并进去，并作废多余记录
	lockID = found[0].id
	totalQty = addQty
	for _, e := range found {
		totalQty += e.qty
	}
		_, err = tx.Exec(ctx,
			`UPDATE swap_matches SET matched_qty = $2, matched_at = NOW() WHERE id = $1`,
			lockID, totalQty,
		)
		if err != nil {
			return uuid.Nil, 0, err
		}
		for _, e := range found[1:] {
			_, err = tx.Exec(ctx,
				`UPDATE swap_matches SET lock_status = 'CANCELLED', matched_qty = 0 WHERE id = $1`,
				e.id,
			)
			if err != nil {
				return uuid.Nil, 0, err
			}
		}
		return lockID, totalQty, nil
	}

func (h *SwapHandler) pushSwapLockEvent(
	targetUserID uuid.UUID,
	msgType string,
	swap SwapListing,
	matchID uuid.UUID,
	matchSide string,
	matchedQty float64,
) {
	if h.wsPush == nil {
		return
	}
	h.wsPush(targetUserID, msgType, gin.H{
		"swap_id":     swap.ID.String(),
		"serial_no":   swap.SerialNo,
		"created_at":  swap.CreatedAt,
		"match_id":    matchID.String(),
		"match_side":  matchSide,
		"matched_qty": matchedQty,
		"side_label":  swapLockSideLabel(matchSide),
	})
}

// pushTradeNotifications 推送成交：行情成交广播；双方换盘(swap_private)点对点推送给买卖双方，
// 确保被动方也能收到「换盘成功」提示（此前私人成交不广播导致只有主动方 HTTP toast）。
func (h *SwapHandler) pushTradeNotifications(trades []*repo.Trade) {
	for _, tr := range trades {
		if tr == nil || tr.ID == uuid.Nil {
			continue
		}
		payload := engine.Trade{
			ID:         tr.ID.String(),
			BuyOrder:   tr.BuyOrderID.String(),
			SellOrder:  tr.SellOrderID.String(),
			ProductID:  tr.ProductID,
			Price:      tr.Price,
			Quantity:   tr.Quantity,
			Timestamp:  tr.TradedAt,
			Source:     tr.Source,
			BuyUserID:  tr.BuyUserID.String(),
			SellUserID: tr.SellUserID.String(),
		}
		if tr.AggressorUserID != nil {
			payload.AggressorUserID = tr.AggressorUserID.String()
		}
		if tr.NotifyListingUserID != nil {
			payload.ListingUserID = tr.NotifyListingUserID.String()
		}
		if tr.Source == repo.TradeSourceSwapPrivate {
			if h.wsPush == nil {
				continue
			}
			h.wsPush(tr.BuyUserID, "trade", payload)
			if tr.SellUserID != tr.BuyUserID {
				h.wsPush(tr.SellUserID, "trade", payload)
			}
			continue
		}
		if h.broadcast != nil {
			h.broadcast <- payload
		}
	}
}

// MySwaps 查询我的换盘
func (h *SwapHandler) MySwaps(c *gin.Context) {
	userID := middleware.GetUserID(c)
	ctx := c.Request.Context()

	rows, err := h.pool.Query(ctx, `
		SELECT id, serial_no, user_id,
		       sell_product_id, sell_price, sell_quantity, sell_filled, sell_delivery_period, sell_delivery_location,
		       buy_product_id,  buy_price,  buy_quantity,  buy_filled,  buy_delivery_period,  buy_delivery_location,
		       sell_allow_partial, sell_min_quantity, buy_allow_partial, buy_min_quantity,
		       sell_payment_method, buy_payment_method,
		       sell_delivery_method, buy_delivery_method,
		       sell_free_storage_enabled, buy_free_storage_enabled,
		       sell_free_storage_days, buy_free_storage_days,
		       sell_specs, buy_specs,
		       remark, status, expires_at, starts_at, created_at, updated_at,
		       sell_allow_counter_offer, sell_negotiable_terms,
		       buy_allow_counter_offer, buy_negotiable_terms,
		       allow_counter_offer, negotiable_terms,
		       allow_single_side, single_side_mode
		FROM swap_listings
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT 50`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	defer rows.Close()

	swaps := make([]SwapListing, 0)
	for rows.Next() {
		var s SwapListing
		if err := rows.Scan(
			&s.ID, &s.SerialNo, &s.UserID,
			&s.SellProductID, &s.SellPrice, &s.SellQuantity, &s.SellFilled, &s.SellDeliveryPeriod, &s.SellDeliveryLocation,
			&s.BuyProductID, &s.BuyPrice, &s.BuyQuantity, &s.BuyFilled, &s.BuyDeliveryPeriod, &s.BuyDeliveryLocation,
			&s.SellAllowPartial, &s.SellMinQuantity, &s.BuyAllowPartial, &s.BuyMinQuantity,
			&s.SellPaymentMethod, &s.BuyPaymentMethod,
			&s.SellDeliveryMethod, &s.BuyDeliveryMethod,
			&s.SellFreeStorageEnabled, &s.BuyFreeStorageEnabled,
			&s.SellFreeStorageDays, &s.BuyFreeStorageDays,
			&s.SellSpecs, &s.BuySpecs,
			&s.Remark, &s.Status, &s.ExpiresAt, &s.StartsAt, &s.CreatedAt, &s.UpdatedAt,
			&s.SellAllowCounterOffer, &s.SellNegotiableTerms,
			&s.BuyAllowCounterOffer, &s.BuyNegotiableTerms,
			&s.AllowCounterOffer, &s.NegotiableTerms,
			&s.AllowSingleSide, &s.SingleSideMode,
		); err != nil {
			continue
		}
		swaps = append(swaps, s)
	}

  c.JSON(http.StatusOK, gin.H{"data": swaps})
}

// --- 内部工具 ---

func ptrStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// swapHandler 不需要 context 参数的简化调用
func swapCtx() context.Context {
	return context.Background()
}

// GetByID 获取单条换盘详情
// GET /api/v1/swaps/detail/:id
// 登录用户若与发盘方任一方拉黑，则不可见（与列表一致）
func (h *SwapHandler) GetByID(c *gin.Context) {
	swapID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的换盘 ID"})
		return
	}

	ctx := c.Request.Context()
	var swap SwapListing
	err = h.pool.QueryRow(ctx, `
		SELECT id, serial_no, user_id,
		       sell_product_id, sell_price, sell_quantity, sell_filled, sell_delivery_period, sell_delivery_location,
		       buy_product_id,  buy_price,  buy_quantity,  buy_filled,  buy_delivery_period,  buy_delivery_location,
		       sell_allow_partial, sell_min_quantity, buy_allow_partial, buy_min_quantity,
		       sell_payment_method, buy_payment_method,
		       sell_delivery_method, buy_delivery_method,
		       sell_free_storage_enabled, buy_free_storage_enabled,
		       sell_free_storage_days, buy_free_storage_days,
		       sell_specs, buy_specs,
		       remark, status, expires_at, starts_at, created_at, updated_at,
		       sell_allow_counter_offer, sell_negotiable_terms,
		       buy_allow_counter_offer, buy_negotiable_terms,
		       allow_counter_offer, negotiable_terms,
		       allow_single_side, single_side_mode
		FROM swap_listings WHERE id=$1`, swapID,
	).Scan(
		&swap.ID, &swap.SerialNo, &swap.UserID,
		&swap.SellProductID, &swap.SellPrice, &swap.SellQuantity, &swap.SellFilled, &swap.SellDeliveryPeriod, &swap.SellDeliveryLocation,
		&swap.BuyProductID, &swap.BuyPrice, &swap.BuyQuantity, &swap.BuyFilled, &swap.BuyDeliveryPeriod, &swap.BuyDeliveryLocation,
		&swap.SellAllowPartial, &swap.SellMinQuantity, &swap.BuyAllowPartial, &swap.BuyMinQuantity,
		&swap.SellPaymentMethod, &swap.BuyPaymentMethod,
		&swap.SellDeliveryMethod, &swap.BuyDeliveryMethod,
		&swap.SellFreeStorageEnabled, &swap.BuyFreeStorageEnabled,
		&swap.SellFreeStorageDays, &swap.BuyFreeStorageDays,
		&swap.SellSpecs, &swap.BuySpecs,
		&swap.Remark, &swap.Status, &swap.ExpiresAt, &swap.StartsAt, &swap.CreatedAt, &swap.UpdatedAt,
		&swap.SellAllowCounterOffer, &swap.SellNegotiableTerms,
		&swap.BuyAllowCounterOffer, &swap.BuyNegotiableTerms,
		&swap.AllowCounterOffer, &swap.NegotiableTerms,
		&swap.AllowSingleSide, &swap.SingleSideMode,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "换盘不存在"})
		return
	}
	viewerID := middleware.GetUserID(c)
	if swap.Status == "SCHEDULED" && swap.UserID != viewerID {
		c.JSON(http.StatusNotFound, gin.H{"error": "换盘不存在"})
		return
	}
	if h.blacklistRepo != nil && viewerID != uuid.Nil && swap.UserID != viewerID {
		if blocked, _ := h.blacklistRepo.IsEitherBlocked(ctx, viewerID, swap.UserID); blocked {
			c.JSON(http.StatusNotFound, gin.H{"error": "换盘不存在"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": swap})
}

// ExpireSwaps 将已到 expires_at 的 OPEN 换盘标记为 EXPIRED
func (h *SwapHandler) ExpireSwaps() {
	ctx := context.Background()
	rows, err := h.pool.Query(ctx, `
		UPDATE swap_listings
		SET status = 'EXPIRED', updated_at = NOW()
		WHERE status = 'OPEN'
		  AND (
		    (expires_at IS NOT NULL AND expires_at <= NOW())
		    OR (expires_at IS NULL AND created_at < (date_trunc('day', NOW() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'))
		  )
		RETURNING id, sell_product_id`)
	if err != nil {
		log.Error().Err(err).Msg("执行过期换盘清理任务失败")
		return
	}
	defer rows.Close()

	products := make(map[string]struct{})
	count := 0
	for rows.Next() {
		var id uuid.UUID
		var productID string
		if err := rows.Scan(&id, &productID); err != nil {
			continue
		}
		count++
		products[productID] = struct{}{}
		if h.coRepo != nil {
			if _, err := h.coRepo.AutoCancelPending(ctx, "swap", id, "换盘已过期"); err != nil {
				log.Error().Err(err).Str("swap_id", id.String()).Msg("过期换盘撤销关联商谈失败")
			}
		}
	}
	if count > 0 {
		log.Info().Int("count", count).Msg("过期换盘已标记为 EXPIRED")
	}
	if h.listingBroadcast != nil {
		for pid := range products {
			h.listingBroadcast <- engine.ListingEvent{ProductID: pid}
		}
	}
}

// ActivateScheduled 将已到 starts_at 的预约换盘改为 OPEN
func (h *SwapHandler) ActivateScheduled() {
	ctx := context.Background()
	rows, err := h.pool.Query(ctx, `
		UPDATE swap_listings
		SET status = 'OPEN', updated_at = NOW()
		WHERE status = 'SCHEDULED'
		  AND starts_at IS NOT NULL
		  AND starts_at <= NOW()
		RETURNING id, sell_product_id`)
	if err != nil {
		log.Error().Err(err).Msg("执行预约换盘激活失败")
		return
	}
	defer rows.Close()

	products := make(map[string]struct{})
	count := 0
	for rows.Next() {
		var id uuid.UUID
		var productID string
		if err := rows.Scan(&id, &productID); err != nil {
			continue
		}
		count++
		products[productID] = struct{}{}
		if h.afterCreateMatch != nil {
			h.afterCreateMatch(ctx, id)
		}
	}
	if count > 0 {
		log.Info().Int("count", count).Msg("预约换盘已自动发布")
	}
	if h.listingBroadcast != nil {
		for pid := range products {
			h.listingBroadcast <- engine.ListingEvent{ProductID: pid}
		}
	}
}

// NotifyScheduleReminders 换盘到期/开盘前约 5 分钟提醒
func (h *SwapHandler) NotifyScheduleReminders() {
	if h.wsPush == nil || h.pool == nil {
		return
	}
	ctx := context.Background()

	rows, err := h.pool.Query(ctx, `
		UPDATE swap_listings
		SET expire_reminded_at = NOW()
		WHERE status = 'OPEN'
		  AND expires_at IS NOT NULL
		  AND expires_at > NOW()
		  AND expires_at <= NOW() + INTERVAL '5 minutes'
		  AND expire_reminded_at IS NULL
		RETURNING id, user_id, serial_no, sell_product_id, expires_at`)
	if err != nil {
		log.Error().Err(err).Msg("查询即将到期换盘提醒失败")
	} else {
		defer rows.Close()
		for rows.Next() {
			var id, userID uuid.UUID
			var serialNo int64
			var productID string
			var expiresAt time.Time
			if err := rows.Scan(&id, &userID, &serialNo, &productID, &expiresAt); err != nil {
				continue
			}
			mins := int(time.Until(expiresAt).Minutes() + 0.999)
			if mins < 1 {
				mins = 1
			}
			h.wsPush(userID, "listing_expire_soon", gin.H{
				"ref_type":     "swap",
				"ref_id":       id.String(),
				"serial_no":    serialNo,
				"product_id":   productID,
				"expires_at":   expiresAt,
				"minutes_left": mins,
			})
		}
	}

	rows2, err := h.pool.Query(ctx, `
		UPDATE swap_listings
		SET start_reminded_at = NOW()
		WHERE status = 'SCHEDULED'
		  AND starts_at IS NOT NULL
		  AND starts_at > NOW()
		  AND starts_at <= NOW() + INTERVAL '5 minutes'
		  AND start_reminded_at IS NULL
		RETURNING id, user_id, serial_no, sell_product_id, starts_at`)
	if err != nil {
		log.Error().Err(err).Msg("查询即将发布换盘提醒失败")
		return
	}
	defer rows2.Close()
	for rows2.Next() {
		var id, userID uuid.UUID
		var serialNo int64
		var productID string
		var startsAt time.Time
		if err := rows2.Scan(&id, &userID, &serialNo, &productID, &startsAt); err != nil {
			continue
		}
		mins := int(time.Until(startsAt).Minutes() + 0.999)
		if mins < 1 {
			mins = 1
		}
		h.wsPush(userID, "listing_publish_soon", gin.H{
			"ref_type":     "swap",
			"ref_id":       id.String(),
			"serial_no":    serialNo,
			"product_id":   productID,
			"starts_at":    startsAt,
			"minutes_left": mins,
		})
	}
}
