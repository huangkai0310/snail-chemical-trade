package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"regexp"
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
	"github.com/huangkai0310/snail-chemical-trade/matching-engine"
)

// 危险字符正则: HTML标签、脚本关键字
var htmlTagPattern = regexp.MustCompile(`(?i)<[^>]*>`)
var scriptPattern = regexp.MustCompile(`(?i)javascript:|onerror|onload|onclick|onmouseover|<script|<iframe|<embed|<object|eval\(|expression\(`)

// sanitizeString 对自由文本字段进行消毒: 去除HTML标签和脚本字符，限制长度
func sanitizeString(s string, maxLen int) string {
	if s == "" {
		return ""
	}
	// 去除HTML标签
	s = htmlTagPattern.ReplaceAllString(s, "")
	// 去除脚本关键字
	s = scriptPattern.ReplaceAllString(s, "")
	// 去除首尾空格
	s = strings.TrimSpace(s)
	// 限制长度
	if len(s) > maxLen {
		s = s[:maxLen]
	}
	return s
}

type ListingHandler struct {
	listingRepo      *repo.ListingRepo
	eng              *engine.Engine
	tradeRepo        *repo.TradeRepo
	accountRepo      *repo.AccountRepo
	coRepo           *repo.CounterOfferRepo
	blacklistRepo    *repo.BlacklistRepo
	broadcast        chan<- engine.Trade
	listingBroadcast chan<- engine.ListingEvent
	pool             *pgxpool.Pool
	wsPush           func(targetUserID uuid.UUID, msgType string, payload interface{})
}

func NewListingHandler(listingRepo *repo.ListingRepo, eng *engine.Engine, tradeRepo *repo.TradeRepo, accountRepo *repo.AccountRepo, broadcast chan<- engine.Trade, listingBroadcast chan<- engine.ListingEvent) *ListingHandler {
	return &ListingHandler{
		listingRepo:     listingRepo,
		eng:             eng,
		tradeRepo:       tradeRepo,
		accountRepo:     accountRepo,
		broadcast:       broadcast,
		listingBroadcast: listingBroadcast,
	}
}

// SetCounterOfferRepo 注入议价 Repo（用于撤盘/摘盘时自动取消关联 PENDING 议价）
func (h *ListingHandler) SetCounterOfferRepo(coRepo *repo.CounterOfferRepo) {
	h.coRepo = coRepo
}

// SetBlacklistRepo 注入黑名单 Repo（用于摘盘前检查 + 列表标记）
func (h *ListingHandler) SetBlacklistRepo(blRepo *repo.BlacklistRepo) {
	h.blacklistRepo = blRepo
}

// SetPool 注入数据库连接池（用于 #697-6 普通挂牌→换盘锁单撮合查询）
func (h *ListingHandler) SetPool(pool *pgxpool.Pool) {
	h.pool = pool
}

// SetWSPush 注入 WebSocket 推送函数（用于 #697-6 撮合成功后通知换盘锁单方）
func (h *ListingHandler) SetWSPush(fn func(targetUserID uuid.UUID, msgType string, payload interface{})) {
	h.wsPush = fn
}

// CreateListingRequest 创建挂牌请求
type CreateListingRequest struct {
	ProductID        string          `json:"product_id" binding:"required"`
	Side             string          `json:"side" binding:"required,oneof=BUY SELL"`
	Price            float64         `json:"price" binding:"required,gt=0"`
	Quantity         float64         `json:"quantity" binding:"required,gt=0"`
	MinQuantity      float64         `json:"min_quantity"`      // 最小成交量（可拆单时生效，0=无限制）
	DeliveryPeriod   string          `json:"delivery_period"`
	DeliveryLocation string          `json:"delivery_location"`
	PaymentMethod    string          `json:"payment_method"` // 付款方式：款到发货/货到付款/预收保证金(10%)/见票付款/账期结算
	Specs            json.RawMessage `json:"specs"`
	Remark           string          `json:"remark"`
	AllowPartial     bool            `json:"allow_partial"`       // 是否允许拆单（默认 false 不可拆）
	AllowCounterOffer *bool           `json:"allow_counter_offer"` // 是否允许议价（默认 true 可议价）
	NegotiableTerms   []string        `json:"negotiable_terms"`    // 可议条款范围（价格/数量/交割期/地/付款/交割方式/免仓/规格），默认全选
	DeliveryMethod    string         `json:"delivery_method"`     // 交割方式：混罐货转/货转/自提/送到，支持自定义
	FreeStorageEnabled *bool         `json:"free_storage_enabled"` // 是否可免仓（默认 true）
	FreeStorageDays   *int           `json:"free_storage_days"`   // 免仓天数（可免仓时生效）
	ExpiresAt         *string        `json:"expires_at"`          // 过期时间 RFC3339；空则默认当日 18:00
	StartsAt          *string        `json:"starts_at"`           // 开始时间；空=立即；未来=定时发布
}

// TakeListingRequest 摘盘请求
type TakeListingRequest struct {
	Quantity float64 `json:"quantity" binding:"required,gt=0"`
}

func listingToOrder(l *repo.Listing) *engine.Order {
	o := engine.OrderFromListing(
		l.ID.String(), l.ProductID, l.UserID.String(),
		engine.Side(l.Side), l.Price, l.Quantity, l.Filled, l.MinQuantity, l.AllowPartial,
		engine.OrderStatus(l.Status), l.CreatedAt,
	)
	// 撮合隔离条款：交割期 / 交割方式 / 免仓期
	if l.DeliveryPeriod != nil {
		o.DeliveryPeriod = *l.DeliveryPeriod
	}
	if l.DeliveryMethod != nil {
		o.DeliveryMethod = *l.DeliveryMethod
	}
	o.FreeStorageEnabled = l.FreeStorageEnabled
	if l.FreeStorageDays != nil {
		o.FreeStorageDays = *l.FreeStorageDays
	}
	return o
}

func listingStatusFromEngine(s engine.OrderStatus) repo.ListingStatus {
	return repo.ListingStatus(s)
}

// Create 创建挂牌 + 触发撮合
func (h *ListingHandler) Create(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req CreateListingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()

	listing, err := h.buildListing(userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.listingRepo.Create(ctx, listing); err != nil {
		log.Error().Err(err).Msg("创建挂牌失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建挂牌失败"})
		return
	}

	// 冻结保证金（买方和卖方都需要冻结；定时盘也预先冻结）
	if h.accountRepo != nil {
		marginRate := repo.DefaultMarginRate
		_, err := h.accountRepo.FreezeMargin(ctx, userID, listing.ID,
			listing.ProductID, listing.Side, listing.Price, listing.Quantity, marginRate)
		if err != nil {
			// 保证金冻结失败，回滚挂牌
			log.Error().Err(err).Msg("冻结保证金失败")
			h.listingRepo.Cancel(ctx, listing.ID, userID)
			c.JSON(http.StatusBadRequest, gin.H{"error": "保证金冻结失败: " + err.Error()})
			return
		}
	}

	// 定时发布：不入撮合簿，到点由 ActivateScheduled 激活
	if listing.Status == repo.ListingScheduled {
		c.JSON(http.StatusOK, gin.H{
			"listing": listing,
			"trades":  []gin.H{},
			"message": "已预约发布",
		})
		return
	}

	order := listingToOrder(listing)
	trades := h.eng.Execute(order)

	tradeResults := h.persistTrades(ctx, trades, listing.DeliveryPeriod, listing.DeliveryLocation, "auto", userID)

	// 引擎成交量先同步到本地；后续换盘自动撮合在此基础上累加
	listing.Filled = order.Filled

	// #697-6 方向二: 普通挂牌 → 换盘 ACTIVE 锁单自动撮合
	remainingQty := listing.Quantity - listing.Filled
	if remainingQty > 0 && h.pool != nil {
		h.matchListingWithSwapLocks(ctx, listing, remainingQty, userID)
	}
	// #697-6b: 普通挂牌 → 换盘剩余单边（未锁定的买/卖腿）自动撮合
	remainingQty = listing.Quantity - listing.Filled
	if remainingQty > 0 && h.pool != nil {
		h.matchListingWithOpenSwapLegs(ctx, listing, remainingQty, userID)
	}

	// 实时推送：新挂牌事件，让其他用户及时看到最新发盘
	if h.listingBroadcast != nil {
		h.listingBroadcast <- engine.ListingEvent{ProductID: listing.ProductID}
	}

	listing.Status = listingStatusFromFilled(listing.Quantity, listing.Filled, listing.Status)
	if err := h.listingRepo.UpdateFilled(ctx, listing.ID, listing.Filled, listing.Status); err != nil {
		log.Error().Err(err).Msg("同步挂牌状态失败（create）")
	}
	// Execute 已把剩余量留在订单簿；此处勿再 Cancel+Load，否则短暂空窗会导致对价盘错过撮合

	c.JSON(http.StatusOK, gin.H{
		"listing": listing,
		"trades":  tradeResults,
	})
}

// Take 摘盘：与指定挂牌直接成交
func (h *ListingHandler) Take(c *gin.Context) {
	userID := middleware.GetUserID(c)
	targetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的挂牌 ID"})
		return
	}

	var req TakeListingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()

	target, err := h.listingRepo.FindByID(ctx, targetID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "挂牌不存在"})
		return
	}

	if target.UserID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不能摘自己的牌"})
		return
	}

	// 黑名单检查（双向）：任一方拉黑了对方，都不能成交
	if h.blacklistRepo != nil {
		dir, _ := h.blacklistRepo.IsBlocked(ctx, userID, target.UserID)
		rev, _ := h.blacklistRepo.IsBlocked(ctx, target.UserID, userID)
		if dir || rev {
			c.JSON(http.StatusForbidden, gin.H{"error": "已拉黑该用户，无法摘盘"})
			return
		}
	}

	if target.Status != repo.ListingOpen && target.Status != repo.ListingPartial {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该挂牌已不可交易"})
		return
	}
	if target.ExpiresAt != nil && !target.ExpiresAt.After(time.Now()) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该挂牌已过期"})
		return
	}

	remaining := target.Quantity - target.Filled
	if req.Quantity > remaining {
		c.JSON(http.StatusBadRequest, gin.H{"error": "摘盘数量超过剩余可成交量"})
		return
	}

	// 统一数量校验：最小单量、不可拆单须全量、操作后剩余量规则
	if req.Quantity > 0 {
		allowPartial := target.AllowPartial
		minQty := target.MinQuantity
		if errMsg := validateListingQtyRemain(req.Quantity, remaining, minQty, allowPartial, "摘盘"); errMsg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
			return
		}
	}

	takerSide := "BUY"
	if target.Side == "BUY" {
		takerSide = "SELL"
	}

	taker := &repo.Listing{
		UserID:             userID,
		ProductID:          target.ProductID,
		Side:               takerSide,
		Price:              target.Price,
		Quantity:           req.Quantity,
		DeliveryPeriod:     target.DeliveryPeriod,
		DeliveryLocation:   target.DeliveryLocation,
		PaymentMethod:      target.PaymentMethod,
		DeliveryMethod:     target.DeliveryMethod,
		FreeStorageEnabled: target.FreeStorageEnabled,
		FreeStorageDays:    target.FreeStorageDays,
		Specs:              target.Specs,
		// 摘盘对向单立即撮合，不可再议价；negotiable_terms 为 NOT NULL，须显式写入
		AllowCounterOffer: false,
		NegotiableTerms:   json.RawMessage(`[]`),
	}
	takerExp := DefaultExpiresAt(time.Now())
	taker.ExpiresAt = &takerExp
	if err := h.listingRepo.Create(ctx, taker); err != nil {
		log.Error().Err(err).Msg("创建摘盘单失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "摘盘失败"})
		return
	}

	// 摘盘方冻结保证金
	if h.accountRepo != nil {
		_, err := h.accountRepo.FreezeMargin(ctx, userID, taker.ID,
			taker.ProductID, taker.Side, taker.Price, taker.Quantity, repo.DefaultMarginRate)
		if err != nil {
			log.Error().Err(err).Msg("摘盘保证金冻结失败")
			h.listingRepo.Cancel(ctx, taker.ID, userID)
			c.JSON(http.StatusBadRequest, gin.H{"error": "保证金冻结失败: " + err.Error()})
			return
		}
	}

	takerOrder := listingToOrder(taker)
	trades, err := h.eng.TakeListing(target.ProductID, targetID.String(), takerOrder)
	if err != nil {
		if errors.Is(err, engine.ErrOrderNotFound) {
			// 目标挂牌不在内存订单簿中（可能引擎重启丢失），尝试重新加载
			targetOrder := listingToOrder(target)
			h.eng.LoadOrder(targetOrder)
			log.Warn().Str("target_id", targetID.String()).Msg("重新加载目标挂牌到订单簿")
			trades, err = h.eng.TakeListing(target.ProductID, targetID.String(), takerOrder)
			if err != nil {
				if errors.Is(err, engine.ErrPriceMismatch) || errors.Is(err, engine.ErrNoQuantity) {
					c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
					return
				}
				log.Error().Err(err).Msg("重新加载后摘盘撮合仍然失败")
				c.JSON(http.StatusInternalServerError, gin.H{"error": "摘盘失败，请刷新后重试"})
				return
			}
		} else if errors.Is(err, engine.ErrPriceMismatch) || errors.Is(err, engine.ErrNoQuantity) || errors.Is(err, engine.ErrMinQuantity) {
			msg := err.Error()
			if errors.Is(err, engine.ErrMinQuantity) {
				msg = "摘盘数量低于对方最小成交量，请增加摘盘数量或摘满剩余量"
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		} else {
			log.Error().Err(err).Msg("摘盘撮合失败")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "摘盘失败"})
			return
		}
	}

	tradeResults := h.persistTrades(ctx, trades, target.DeliveryPeriod, target.DeliveryLocation, "take", userID)

	// 实时推送：新摘盘（生成新挂盘）事件，让其他用户及时看到最新发盘
	if h.listingBroadcast != nil {
		h.listingBroadcast <- engine.ListingEvent{ProductID: target.ProductID}
	}

	taker.Filled = takerOrder.Filled
	taker.Status = listingStatusFromEngine(takerOrder.Status)
	if err := h.listingRepo.UpdateFilled(ctx, taker.ID, taker.Filled, taker.Status); err != nil {
		log.Error().Err(err).Msg("同步挂牌状态失败（take）")
	}

	// 摘盘后如果目标挂牌完全成交，自动撤销关联的 PENDING 议价
	if h.coRepo != nil {
		updatedTarget, err := h.listingRepo.FindByID(ctx, targetID)
		if err == nil && (updatedTarget.Status == repo.ListingFilled) {
			count, err := h.coRepo.AutoCancelPending(ctx, "listing", targetID, "对方已成交")
			if err != nil {
				log.Error().Err(err).Str("listing_id", targetID.String()).Msg("摘盘后自动撤销关联议价失败")
			} else if count > 0 {
				log.Info().Int64("count", count).Str("listing_id", targetID.String()).Msg("摘盘成交自动撤销关联 PENDING 议价")
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"listing": taker,
		"trades":  tradeResults,
	})
}

func (h *ListingHandler) buildListing(userID uuid.UUID, req CreateListingRequest) (*repo.Listing, error) {
	// 对自由文本字段进行消毒
	req.DeliveryPeriod = sanitizeString(req.DeliveryPeriod, 100)
	req.DeliveryLocation = sanitizeString(req.DeliveryLocation, 200)
	req.PaymentMethod = sanitizeString(req.PaymentMethod, 100)
	req.DeliveryMethod = sanitizeString(req.DeliveryMethod, 50)
	req.Remark = sanitizeString(req.Remark, 500)

	var dp, dl, pm, rm *string
	if req.DeliveryPeriod != "" {
		dp = &req.DeliveryPeriod
	}
	if req.DeliveryLocation != "" {
		dl = &req.DeliveryLocation
	}
	if req.PaymentMethod != "" {
		pm = &req.PaymentMethod
	}
	if req.Remark != "" {
		rm = &req.Remark
	}

	// allow_counter_offer 默认 false（不可议价）；仅当显式传 true 时才为可议价
	allowCounterOffer := false
	if req.AllowCounterOffer != nil {
		allowCounterOffer = *req.AllowCounterOffer
	}

	// 可议条款范围：allow_counter_offer=false 时为空（不可议）；
	// 为 true 且前端未传 negotiable_terms 时默认全选（价格/数量/交割期/地/付款/交割方式/免仓/规格）
	var ntRaw json.RawMessage
	if allowCounterOffer {
		terms := sanitizeNegotiableTermList(req.NegotiableTerms)
		if len(terms) == 0 {
			terms = defaultNegotiableTerms()
		}
		ntRaw, _ = json.Marshal(terms)
	} else {
		ntRaw = json.RawMessage("[]")
	}

	// 交割方式
	var dm *string
	if req.DeliveryMethod != "" {
		dm = &req.DeliveryMethod
	}

	// 免仓期：默认可免仓（true）；仅当显式传 false 时才不免仓
	freeStorageEnabled := true
	if req.FreeStorageEnabled != nil {
		freeStorageEnabled = *req.FreeStorageEnabled
	}
	// 免仓天数：可免仓时才有意义。未传时按数量给默认值（≥100 默认 7 天，<100 默认 3 天）
	var fsDays *int
	if freeStorageEnabled {
		if req.FreeStorageDays != nil && *req.FreeStorageDays > 0 {
			fsDays = req.FreeStorageDays
		} else {
			d := 3
			if req.Quantity >= 100 {
				d = 7
			}
			fsDays = &d
		}
	}

	expiresAt, err := ResolveExpiresAt(req.ExpiresAt, time.Now())
	if err != nil {
		return nil, err
	}

	startsAt, scheduled, err := ResolveStartsAt(req.StartsAt, time.Now())
	if err != nil {
		return nil, err
	}
	status := repo.ListingOpen
	if scheduled {
		status = repo.ListingScheduled
		// 定时盘：过期时间须晚于开始时间
		if !expiresAt.After(*startsAt) {
			return nil, fmt.Errorf("过期时间必须晚于开始时间")
		}
	}

	return &repo.Listing{
		UserID:           userID,
		ProductID:        req.ProductID,
		Side:             req.Side,
		Price:            req.Price,
		Quantity:         req.Quantity,
		MinQuantity:      req.MinQuantity,
		AllowPartial:     req.AllowPartial,
		AllowCounterOffer: allowCounterOffer,
		NegotiableTerms:  ntRaw,
		DeliveryPeriod:   dp,
		DeliveryLocation: dl,
		PaymentMethod:    pm,
		DeliveryMethod:   dm,
		FreeStorageEnabled: freeStorageEnabled,
		FreeStorageDays:  fsDays,
		Specs:            req.Specs,
		Remark:           rm,
		ExpiresAt:        &expiresAt,
		StartsAt:         startsAt,
		Status:           status,
	}, nil
}

func (h *ListingHandler) persistTrades(ctx context.Context, trades []engine.Trade, deliveryPeriod *string, deliveryLocation *string, source string, aggressorUserID uuid.UUID) []gin.H {
	results := make([]gin.H, 0) // 确保序列化为 [] 而不是 null
	// 挂牌详情缓存，避免同一笔成交内重复查询买卖挂牌
	listingCache := make(map[uuid.UUID]*repo.Listing)
	getListing := func(id uuid.UUID) *repo.Listing {
		if l, ok := listingCache[id]; ok {
			return l
		}
		l, err := h.listingRepo.FindByID(ctx, id)
		if err != nil {
			log.Error().Err(err).Str("order_id", id.String()).Msg("获取挂牌详情失败")
			listingCache[id] = nil
			return nil
		}
		listingCache[id] = l
		return l
	}
	for _, t := range trades {
		buyOrderID, _ := uuid.Parse(t.BuyOrder)
		sellOrderID, _ := uuid.Parse(t.SellOrder)

		buyUID, err := h.listingRepo.GetUserID(ctx, buyOrderID)
		if err != nil {
			log.Error().Err(err).Str("order_id", t.BuyOrder).Msg("获取买方用户失败")
		}
		sellUID, err := h.listingRepo.GetUserID(ctx, sellOrderID)
		if err != nil {
			log.Error().Err(err).Str("order_id", t.SellOrder).Msg("获取卖方用户失败")
		}

		// 填充双边发盘条款明细（序号、付款方式、交割方式、免仓期、规格）
		buyListing := getListing(buyOrderID)
		sellListing := getListing(sellOrderID)

		trade := &repo.Trade{
			ProductID:        t.ProductID,
			BuyOrderID:       buyOrderID,
			SellOrderID:      sellOrderID,
			BuyUserID:        buyUID,
			SellUserID:       sellUID,
			Price:            t.Price,
			Quantity:         t.Quantity,
			DeliveryPeriod:   deliveryPeriod,
			DeliveryLocation: deliveryLocation,
		}
		if buyListing != nil {
			trade.BuySerialNo = &buyListing.SerialNo
			trade.BuyPaymentMethod = buyListing.PaymentMethod
			trade.BuySpecs = normalizeSpecs(buyListing.Specs)
			trade.DeliveryMethod = buyListing.DeliveryMethod
			trade.FreeStorageEnabled = &buyListing.FreeStorageEnabled
			trade.FreeStorageDays = buyListing.FreeStorageDays
		}
		if sellListing != nil {
			trade.SellSerialNo = &sellListing.SerialNo
			trade.SellPaymentMethod = sellListing.PaymentMethod
			trade.SellSpecs = normalizeSpecs(sellListing.Specs)
		}
		trade.Source = source
		if aggressorUserID != uuid.Nil {
			ag := aggressorUserID
			trade.AggressorUserID = &ag
		}

		// 使用事务保证 成交记录写入 + 挂牌状态更新 原子性
		tx, err := h.listingRepo.BeginTx(ctx)
		if err != nil {
			log.Error().Err(err).Msg("开启事务失败")
			continue
		}

		if err := h.tradeRepo.CreateTx(ctx, tx, trade); err != nil {
			log.Error().Err(err).Msg("保存成交失败")
			tx.Rollback(ctx)
			continue
		}

		if err := h.listingRepo.AddFilledTx(ctx, tx, buyOrderID, t.Quantity); err != nil {
			if err == repo.ErrNotFound {
				log.Warn().Str("order_id", t.BuyOrder).Msg("买方挂牌已被撤盘/成交，跳过该笔成交")
			} else {
				log.Error().Err(err).Str("order_id", t.BuyOrder).Msg("更新买方挂牌已成交量失败")
			}
			tx.Rollback(ctx)
			continue
		}

		if err := h.listingRepo.AddFilledTx(ctx, tx, sellOrderID, t.Quantity); err != nil {
			if err == repo.ErrNotFound {
				log.Warn().Str("order_id", t.SellOrder).Msg("卖方挂牌已被撤盘/成交，跳过该笔成交")
			} else {
				log.Error().Err(err).Str("order_id", t.SellOrder).Msg("更新卖方挂牌已成交量失败")
			}
			tx.Rollback(ctx)
			continue
		}

		if err := tx.Commit(ctx); err != nil {
			log.Error().Err(err).Msg("提交事务失败")
			continue
		}

		// 成交后资金结算（买方扣款/保证金、卖方收款）
		if h.accountRepo != nil {
			if err := h.accountRepo.SettleTrade(ctx,
				buyUID, sellUID,
				buyOrderID, // 买方挂牌 ID（用于查保证金记录）
				trade.ID,
				t.Price, t.Quantity,
			); err != nil {
				log.Error().Err(err).
					Str("trade_id", trade.ID.String()).
					Msg("成交资金结算失败（成交已成功，结算异步补偿）")
				// 注意：成交已写入数据库，资金结算失败需要人工处理或异步补偿
				// 这里不影响主流程，只记录日志
			}
		}

		if h.broadcast != nil {
			t.Source = source
			if aggressorUserID != uuid.Nil {
				t.AggressorUserID = aggressorUserID.String()
			}
			h.broadcast <- t
		}

		results = append(results, gin.H{
			"id":         trade.ID,
			"product_id": trade.ProductID,
			"price":      trade.Price,
			"quantity":   trade.Quantity,
			"amount":     trade.Amount,
			"traded_at":  trade.TradedAt,
		})
	}
	return results
}

// normalizeSpecs 将空/空对象/ null 的 specs 规整为 nil，避免写入数据库空对象或前端渲染异常
func normalizeSpecs(s json.RawMessage) json.RawMessage {
	if len(s) == 0 {
		return nil
	}
	trimmed := bytes.TrimSpace(s)
	if string(trimmed) == "{}" || string(trimmed) == "null" {
		return nil
	}
	return s
}

// MyListings 查询当前用户的所有挂牌
func (h *ListingHandler) MyListings(c *gin.Context) {
	userID := middleware.GetUserID(c)
	listings, err := h.listingRepo.ListByUser(c.Request.Context(), userID, 50)
	if err != nil {
		log.Error().Err(err).Msg("查询我的挂牌失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	if listings == nil {
		listings = []repo.Listing{}
	}
	c.JSON(http.StatusOK, gin.H{"data": listings})
}

// List 列表查询（支持筛选+分页）
// GET /api/v1/listings?product_id=benzene&side=BUY&delivery_period=2606下&page=1&page_size=20
func (h *ListingHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)
	productID := c.Query("product_id")
	serialNoQuery := c.Query("serial_no")

	// #304：当指定 serial_no 时，允许不传 product_id（跨品种按序号精确查询）
	// 兼容老逻辑：买家盘列表页仍可以 product_id 必填方式使用
	if productID == "" && serialNoQuery == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请指定 product_id 或 serial_no"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	f := repo.ListFilter{
		ProductID:      productID,
		Side:           c.Query("side"),
		DeliveryPeriod: c.Query("delivery_period"),
		Status:         c.Query("status"),
		Offset:         (page - 1) * pageSize,
		Limit:          pageSize,
	}
	if userID != uuid.Nil {
		f.IncludeScheduledUserID = userID
	}
	if sn := c.Query("serial_no"); sn != "" {
		if n, err := strconv.ParseInt(sn, 10, 64); err == nil {
			f.SerialNo = n
		}
	}

	ctx := c.Request.Context()

	// 黑名单：任一方拉黑则双方互相看不到对方发盘（查询与计数均排除）
	blockedSet := make(map[uuid.UUID]bool)
	if h.blacklistRepo != nil && userID != uuid.Nil {
		blockedSet, _ = h.blacklistRepo.GetBlockedUserIDs(ctx, userID)
		if invisible, err := h.blacklistRepo.GetInvisiblePeerIDs(ctx, userID); err == nil && len(invisible) > 0 {
			ids := make([]uuid.UUID, 0, len(invisible))
			for id := range invisible {
				ids = append(ids, id)
			}
			f.ExcludeUserIDs = ids
		}
	}

	listings, total, err := h.listingRepo.ListFiltered(ctx, f)
	if err != nil {
		log.Error().Err(err).Msg("查询挂牌列表失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}

	if listings == nil {
		listings = []repo.Listing{}
	}

	// 构建响应：在每条挂牌上追加 is_blocked 字段
	type listingWithBlocked struct {
		repo.Listing
		IsBlocked bool `json:"is_blocked"`
	}

	result := make([]listingWithBlocked, 0, len(listings))
	for _, l := range listings {
		result = append(result, listingWithBlocked{
			Listing:   l,
			IsBlocked: blockedSet[l.UserID],
		})
	}

	totalPage := 0
	if pageSize > 0 {
		totalPage = (total + pageSize - 1) / pageSize
	}

	c.JSON(http.StatusOK, gin.H{
		"data":       result,
		"total":      total,
		"page":       page,
		"page_size":  pageSize,
		"total_page": totalPage,
	})
}

// UpdateListingRequest 编辑挂牌请求（与 CreateListingRequest 类似，但 product_id/side 不可改）
type UpdateListingRequest struct {
	Price             float64         `json:"price" binding:"required,gt=0"`
	Quantity          float64         `json:"quantity" binding:"required,gt=0"`
	MinQuantity       float64         `json:"min_quantity"`
	DeliveryPeriod    string          `json:"delivery_period"`
	DeliveryLocation  string          `json:"delivery_location"`
	PaymentMethod     string          `json:"payment_method"`
	DeliveryMethod    string          `json:"delivery_method"`
	FreeStorageEnabled *bool          `json:"free_storage_enabled"`
	FreeStorageDays   *int            `json:"free_storage_days"`
	Specs             json.RawMessage `json:"specs"`
	Remark            string          `json:"remark"`
	AllowPartial      bool            `json:"allow_partial"`
	AllowCounterOffer *bool           `json:"allow_counter_offer"`
	NegotiableTerms   []string        `json:"negotiable_terms"`
	ExpiresAt         *string         `json:"expires_at"` // 过期时间；空则保留原值
	StartsAt          *string         `json:"starts_at"`  // 开始时间；空=立即
}

// Update 编辑挂牌（仅自己的 OPEN/PARTIAL 挂牌可编辑）
// PATCH /api/v1/listings/:id
func (h *ListingHandler) Update(c *gin.Context) {
	userID := middleware.GetUserID(c)
	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的挂牌 ID"})
		return
	}

	var req UpdateListingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 对自由文本字段进行消毒
	req.DeliveryPeriod = sanitizeString(req.DeliveryPeriod, 100)
	req.DeliveryLocation = sanitizeString(req.DeliveryLocation, 200)
	req.PaymentMethod = sanitizeString(req.PaymentMethod, 100)
	req.DeliveryMethod = sanitizeString(req.DeliveryMethod, 50)
	req.Remark = sanitizeString(req.Remark, 500)

	ctx := c.Request.Context()

	// 查原盘，校验 ownership + status
	existing, err := h.listingRepo.FindByID(ctx, listingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "挂牌不存在"})
		return
	}
	if existing.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "只能编辑自己的挂牌"})
		return
	}
	if existing.Status != repo.ListingOpen && existing.Status != repo.ListingPartial && existing.Status != repo.ListingScheduled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该挂牌状态不可编辑"})
		return
	}

	// 已成交部分不可缩减
	remaining := req.Quantity - existing.Filled
	if remaining <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "修改后的数量不能少于已成交量"})
		return
	}

	allowCounterOffer := false
	if req.AllowCounterOffer != nil {
		allowCounterOffer = *req.AllowCounterOffer
	}

	// 已有 PENDING 商谈：禁止改动可议范围与盘面核心条款（公平对待已出价对手）
	if h.coRepo != nil {
		pending, err := h.coRepo.CountPendingByRef(ctx, "listing", listingID)
		if err == nil && pending > 0 {
			if negotiableTermsChanged(existing.NegotiableTerms, req.NegotiableTerms, allowCounterOffer, existing.AllowCounterOffer) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "该盘已有待处理商谈，请先处理完商谈后再修改可议条款"})
				return
			}
			if listingCommercialChanged(existing, &req) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "该盘已有待处理商谈，盘面条款暂不可改，请先处理商谈"})
				return
			}
		}
	}

	// 构建更新实体（保留不可改字段）
	var dp, dl, pm, rm, dm *string
	if req.DeliveryPeriod != "" {
		dp = &req.DeliveryPeriod
	}
	if req.DeliveryLocation != "" {
		dl = &req.DeliveryLocation
	}
	if req.PaymentMethod != "" {
		pm = &req.PaymentMethod
	}
	if req.Remark != "" {
		rm = &req.Remark
	}
	if req.DeliveryMethod != "" {
		dm = &req.DeliveryMethod
	}

	var ntRaw json.RawMessage
	if allowCounterOffer {
		terms := sanitizeNegotiableTermList(req.NegotiableTerms)
		if len(terms) == 0 {
			terms = defaultNegotiableTerms()
		}
		ntRaw, _ = json.Marshal(terms)
	} else {
		ntRaw = json.RawMessage("[]")
	}

	freeStorageEnabled := true
	if req.FreeStorageEnabled != nil {
		freeStorageEnabled = *req.FreeStorageEnabled
	}
	var fsDays *int
	if freeStorageEnabled {
		if req.FreeStorageDays != nil && *req.FreeStorageDays > 0 {
			fsDays = req.FreeStorageDays
		} else {
			// 编辑时未传天数：保留原值，不按数量自动补默认（避免只改数量却改写免仓期）
			fsDays = existing.FreeStorageDays
		}
	}

	var expiresAt *time.Time
	if req.ExpiresAt != nil && strings.TrimSpace(*req.ExpiresAt) != "" {
		t, err := ResolveExpiresAt(req.ExpiresAt, time.Now())
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		expiresAt = &t
	} else if existing.ExpiresAt != nil {
		expiresAt = existing.ExpiresAt
	} else {
		d := DefaultExpiresAt(time.Now())
		expiresAt = &d
	}

	startsAt, scheduled, err := ResolveStartsAt(req.StartsAt, time.Now())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// 编辑时未传 starts_at：保留原计划（若原为 SCHEDULED 且开始时间仍在未来）
	newStatus := existing.Status
	wasScheduled := existing.Status == repo.ListingScheduled
	if req.StartsAt != nil {
		if scheduled {
			newStatus = repo.ListingScheduled
			if !expiresAt.After(*startsAt) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "过期时间必须晚于开始时间"})
				return
			}
		} else if wasScheduled {
			// 改为立即发布
			newStatus = repo.ListingOpen
			startsAt = nil
		} else {
			startsAt = existing.StartsAt
		}
	} else if wasScheduled {
		startsAt = existing.StartsAt
		if existing.StartsAt != nil && existing.StartsAt.After(time.Now()) {
			newStatus = repo.ListingScheduled
		} else {
			newStatus = repo.ListingOpen
			startsAt = nil
		}
	}

	updated := &repo.Listing{
		ID:                listingID,
		UserID:            userID,
		Price:             req.Price,
		Quantity:          req.Quantity,
		MinQuantity:       req.MinQuantity,
		DeliveryPeriod:    dp,
		DeliveryLocation:  dl,
		PaymentMethod:     pm,
		DeliveryMethod:    dm,
		FreeStorageEnabled: freeStorageEnabled,
		FreeStorageDays:   fsDays,
		Specs:             req.Specs,
		Remark:            rm,
		AllowPartial:      req.AllowPartial,
		AllowCounterOffer: allowCounterOffer,
		NegotiableTerms:   ntRaw,
		ExpiresAt:         expiresAt,
		StartsAt:          startsAt,
		Status:            newStatus,
	}

	if err := h.listingRepo.Update(ctx, updated); err != nil {
		if err == repo.ErrNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "挂牌不存在或不可编辑"})
			return
		}
		log.Error().Err(err).Msg("编辑挂牌失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "编辑失败"})
		return
	}

	// 仍为定时盘：不入撮合
	if newStatus == repo.ListingScheduled {
		if h.listingBroadcast != nil {
			h.listingBroadcast <- engine.ListingEvent{ProductID: existing.ProductID}
		}
		refreshed, err := h.listingRepo.FindByID(ctx, listingID)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"data": updated})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": refreshed})
		return
	}

	// 从定时转为立即，或编辑已开盘：重撮合
	h.eng.CancelOrder(existing.ProductID, listingID.String())
	refreshed, err := h.listingRepo.FindByID(ctx, listingID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"data": updated})
		return
	}
	newOrder := listingToOrder(refreshed)
	trades := h.eng.Execute(newOrder)
	tradeResults := []gin.H{}
	if len(trades) > 0 {
		tradeResults = h.persistTrades(ctx, trades, refreshed.DeliveryPeriod, refreshed.DeliveryLocation, "auto", userID)
		refreshed.Filled = newOrder.Filled
		refreshed.Status = listingStatusFromFilled(refreshed.Quantity, refreshed.Filled, refreshed.Status)
		if err := h.listingRepo.UpdateFilled(ctx, refreshed.ID, refreshed.Filled, refreshed.Status); err != nil {
			log.Error().Err(err).Msg("编辑后同步挂牌成交量失败")
		}
		if refreshed2, err2 := h.listingRepo.FindByID(ctx, listingID); err2 == nil {
			refreshed = refreshed2
		}
	}

	// 实时推送
	if h.listingBroadcast != nil {
		h.listingBroadcast <- engine.ListingEvent{ProductID: existing.ProductID}
	}

	c.JSON(http.StatusOK, gin.H{"data": refreshed, "trades": tradeResults})
}

// Cancel 撤牌（从我的挂牌栏调用）
// 使用事务 + SELECT FOR UPDATE 保证「撤盘 + 撤销关联商谈」原子性。
// 事务内先锁住 listing 行，再执行 UPDATE status=CANCELLED，再撤销 PENDING 商谈。
// 如果在锁住之前 listing 已被成交（status 变为 FILLED），则撤盘失败返回"已不可撤销"。
func (h *ListingHandler) Cancel(c *gin.Context) {
	userID := middleware.GetUserID(c)
	id := c.Param("id")

	listingID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的挂牌 ID"})
		return
	}

	ctx := c.Request.Context()

	// 先查一次（非锁）做快速校验
	listing, err := h.listingRepo.FindByID(ctx, listingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "挂牌不存在"})
		return
	}
	if listing.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "只能撤销自己的挂牌"})
		return
	}
	if listing.Status != repo.ListingOpen && listing.Status != repo.ListingPartial && listing.Status != repo.ListingScheduled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该挂牌已不可撤销"})
		return
	}

	// 开启事务：SELECT FOR UPDATE 锁住行 → 撤盘 → 撤销关联商谈
	tx, err := h.listingRepo.BeginTx(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "撤盘事务开启失败"})
		return
	}
	defer tx.Rollback(ctx)

	// 行锁：防止与 Take/Accept 的并发写入冲突
	locked, err := h.listingRepo.LockByIDTx(ctx, tx, listingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "挂牌不存在"})
		return
	}
	if locked.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "只能撤销自己的挂牌"})
		return
	}
	if locked.Status != repo.ListingOpen && locked.Status != repo.ListingPartial && locked.Status != repo.ListingScheduled {
		// 在等待锁的期间，挂牌可能已被成交或被撤盘
		c.JSON(http.StatusBadRequest, gin.H{"error": "该挂牌已不可撤销（可能已被成交）"})
		return
	}

	// 在事务内执行撤盘
	if err := h.listingRepo.CancelTx(ctx, tx, listingID, userID); err != nil {
		if err == repo.ErrNotFound {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该挂牌已不可撤销（可能已被成交）"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "撤销失败"})
		return
	}

	// 在事务内撤销关联的 PENDING 商谈
	var cancelledCOCount int64
	if h.coRepo != nil {
		count, err := h.coRepo.AutoCancelPendingTx(ctx, tx, "listing", listingID, "对方已撤盘")
		if err != nil {
			log.Error().Err(err).Str("listing_id", listingID.String()).Msg("事务内撤销关联商谈失败")
			// 商谈撤销失败不应阻止撤盘，事务继续提交
		} else {
			cancelledCOCount = count
		}
	}

	if err := tx.Commit(ctx); err != nil {
		log.Error().Err(err).Str("listing_id", listingID.String()).Msg("提交撤盘事务失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "撤盘提交失败"})
		return
	}

	// 事务提交成功后的后置操作（非关键路径，失败仅记录日志）

	// 从撮合引擎中移除
	h.eng.CancelOrder(listing.ProductID, listingID.String())

	// 释放冻结的保证金
	if h.accountRepo != nil {
		if err := h.accountRepo.ReleaseMargin(ctx, listingID); err != nil {
			log.Error().Err(err).Str("listing_id", listingID.String()).Msg("释放保证金失败（不影响撤单）")
		}
	}

	if cancelledCOCount > 0 {
		log.Info().Int64("count", cancelledCOCount).Str("listing_id", listingID.String()).Msg("撤盘自动撤销关联 PENDING 商谈")
	}

	// 实时推送：撤盘事件，让其他用户及时刷新发盘列表
	if h.listingBroadcast != nil {
		h.listingBroadcast <- engine.ListingEvent{ProductID: listing.ProductID}
	}

	c.JSON(http.StatusOK, gin.H{"message": "撤盘成功"})
}

// ExpireListings 定时任务：将已到 expires_at 的未成交挂牌标记为 EXPIRED，并从撮合引擎移除
func (h *ListingHandler) ExpireListings() {
	ctx := context.Background()
	expired, err := h.listingRepo.ExpireOutdated(ctx)
	if err != nil {
		log.Error().Err(err).Msg("执行过期挂牌清理任务失败")
		return
	}
	if len(expired) == 0 {
		return
	}
	log.Info().Int("count", len(expired)).Msg("过期挂牌已标记为 EXPIRED")
	products := make(map[string]struct{})
	for _, e := range expired {
		h.eng.CancelOrder(e.ProductID, e.ID.String())
		if h.accountRepo != nil {
			if err := h.accountRepo.ReleaseMargin(ctx, e.ID); err != nil {
				log.Error().Err(err).Str("listing_id", e.ID.String()).Msg("过期挂牌释放保证金失败")
			}
		}
		if h.coRepo != nil {
			if _, err := h.coRepo.AutoCancelPending(ctx, "listing", e.ID, "挂牌已过期"); err != nil {
				log.Error().Err(err).Str("listing_id", e.ID.String()).Msg("过期挂牌撤销关联商谈失败")
			}
		}
		products[e.ProductID] = struct{}{}
	}
	if h.listingBroadcast != nil {
		for pid := range products {
			h.listingBroadcast <- engine.ListingEvent{ProductID: pid}
		}
	}
}

// ActivateScheduled 将已到 starts_at 的预约挂牌改为 OPEN 并入撮合
func (h *ListingHandler) ActivateScheduled() {
	ctx := context.Background()
	activated, err := h.listingRepo.ActivateScheduled(ctx)
	if err != nil {
		log.Error().Err(err).Msg("执行预约挂牌激活失败")
		return
	}
	if len(activated) == 0 {
		return
	}
	log.Info().Int("count", len(activated)).Msg("预约挂牌已自动发布")
	products := make(map[string]struct{})
	for _, e := range activated {
		listing, err := h.listingRepo.FindByID(ctx, e.ID)
		if err != nil {
			continue
		}
		order := listingToOrder(listing)
		trades := h.eng.Execute(order)
		if len(trades) > 0 {
			h.persistTrades(ctx, trades, listing.DeliveryPeriod, listing.DeliveryLocation, "auto", uuid.Nil)
			listing.Filled = order.Filled
			listing.Status = listingStatusFromFilled(listing.Quantity, listing.Filled, listing.Status)
			_ = h.listingRepo.UpdateFilled(ctx, listing.ID, listing.Filled, listing.Status)
		}
		products[e.ProductID] = struct{}{}
	}
	if h.listingBroadcast != nil {
		for pid := range products {
			h.listingBroadcast <- engine.ListingEvent{ProductID: pid}
		}
	}
}

// NotifyScheduleReminders 到期/开盘前约 5 分钟提醒发盘人（去重）
func (h *ListingHandler) NotifyScheduleReminders() {
	if h.wsPush == nil || h.pool == nil {
		return
	}
	ctx := context.Background()

	// 即将到期（OPEN/PARTIAL，5 分钟内且未提醒）
	rows, err := h.pool.Query(ctx, `
		UPDATE listings
		SET expire_reminded_at = NOW()
		WHERE status IN ('OPEN', 'PARTIAL')
		  AND expires_at IS NOT NULL
		  AND expires_at > NOW()
		  AND expires_at <= NOW() + INTERVAL '5 minutes'
		  AND expire_reminded_at IS NULL
		RETURNING id, user_id, serial_no, product_id, side, expires_at`)
	if err != nil {
		log.Error().Err(err).Msg("查询即将到期挂牌提醒失败")
	} else {
		defer rows.Close()
		for rows.Next() {
			var id, userID uuid.UUID
			var serialNo int64
			var productID, side string
			var expiresAt time.Time
			if err := rows.Scan(&id, &userID, &serialNo, &productID, &side, &expiresAt); err != nil {
				continue
			}
			mins := int(time.Until(expiresAt).Minutes() + 0.999)
			if mins < 1 {
				mins = 1
			}
			h.wsPush(userID, "listing_expire_soon", gin.H{
				"ref_type":    "listing",
				"ref_id":      id.String(),
				"serial_no":   serialNo,
				"product_id":  productID,
				"side":        side,
				"expires_at":  expiresAt,
				"minutes_left": mins,
			})
		}
	}

	// 即将发布（SCHEDULED，5 分钟内且未提醒）
	rows2, err := h.pool.Query(ctx, `
		UPDATE listings
		SET start_reminded_at = NOW()
		WHERE status = 'SCHEDULED'
		  AND starts_at IS NOT NULL
		  AND starts_at > NOW()
		  AND starts_at <= NOW() + INTERVAL '5 minutes'
		  AND start_reminded_at IS NULL
		RETURNING id, user_id, serial_no, product_id, side, starts_at`)
	if err != nil {
		log.Error().Err(err).Msg("查询即将发布挂牌提醒失败")
		return
	}
	defer rows2.Close()
	for rows2.Next() {
		var id, userID uuid.UUID
		var serialNo int64
		var productID, side string
		var startsAt time.Time
		if err := rows2.Scan(&id, &userID, &serialNo, &productID, &side, &startsAt); err != nil {
			continue
		}
		mins := int(time.Until(startsAt).Minutes() + 0.999)
		if mins < 1 {
			mins = 1
		}
		h.wsPush(userID, "listing_publish_soon", gin.H{
			"ref_type":     "listing",
			"ref_id":       id.String(),
			"serial_no":    serialNo,
			"product_id":   productID,
			"side":         side,
			"starts_at":    startsAt,
			"minutes_left": mins,
		})
	}
}

// ExpireListingsHandler 管理后台手动触发过期挂牌清理
// POST /api/v1/admin/expire-listings
func (h *ListingHandler) ExpireListingsHandler(c *gin.Context) {
	h.ExpireListings()
	c.JSON(http.StatusOK, gin.H{
		"message": "执行成功",
	})
}

// GetByID 获取单条挂牌详情
// GET /api/v1/listings/detail/:id
// 登录用户若与发盘方任一方拉黑，则不可见（与列表一致）
func (h *ListingHandler) GetByID(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的挂牌 ID"})
		return
	}
	ctx := c.Request.Context()
	listing, err := h.listingRepo.FindByID(ctx, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "挂牌不存在"})
		return
	}
	viewerID := middleware.GetUserID(c)
	if listing.Status == repo.ListingScheduled && listing.UserID != viewerID {
		c.JSON(http.StatusNotFound, gin.H{"error": "挂牌不存在"})
		return
	}
	if h.blacklistRepo != nil && viewerID != uuid.Nil && listing.UserID != viewerID {
		if blocked, _ := h.blacklistRepo.IsEitherBlocked(ctx, viewerID, listing.UserID); blocked {
			c.JSON(http.StatusNotFound, gin.H{"error": "挂牌不存在"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": listing})
}

// validateListingQtyRemain 校验摘盘数量：最小单量、不可拆单须全量、操作后剩余量
// 与 swap.go 的 validateSwapQtyRemain 逻辑一致，确保全站统一数量校验规则
func validateListingQtyRemain(qty, remain, minQty float64, allowPartial bool, label string) string {
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
	// 剩余量不足再保留一个最小单量：只能全部操作（允许尾量非整数倍）
	if allowPartial && remain < effectiveMin*2 {
		if qty != remain {
			return fmt.Sprintf("%s剩余量 %.0f 不足再保留最小单量 %.0f，须全部操作 %.0f", label, remain, effectiveMin, remain)
		}
		return ""
	}
	if qty < effectiveMin {
		return fmt.Sprintf("%s数量不能小于最小单量 %.0f", label, effectiveMin)
	}
	// 按份数：部分操作时数量须为每份整数倍；全部吃光剩余量时放行（避免历史非整数倍余量卡死）
	if allowPartial && minQty > 0 && qty != remain {
		qi, mi := int64(qty), int64(effectiveMin)
		if mi > 0 && qi%mi != 0 {
			return fmt.Sprintf("%s数量须为每份 %.0f 的整数倍", label, effectiveMin)
		}
	}
	after := remain - qty
	if after > 0 && after < effectiveMin {
		return fmt.Sprintf("%s后剩余量须为 0 或 ≥ 最小单量 %.0f", label, effectiveMin)
	}
	return ""
}

// matchListingWithSwapLocks #697-6 方向二：普通挂牌创建后，检查是否有匹配的换盘 ACTIVE 锁单
// 条件：锁单方向与挂牌对应（sell 锁定→需要 sell 挂牌；buy 锁定→需要 buy 挂盘）、
//       条款完全一致（价格、数量、交割期、交割方式、免仓期等）、不同用户、黑名单过滤
func (h *ListingHandler) matchListingWithSwapLocks(ctx context.Context, listing *repo.Listing, remainingQty float64, listingUserID uuid.UUID) {
	// 普通挂牌 side 是 BUY 或 SELL（大写），换盘锁单 match_side 是 sell/buy（小写）
	// 挂牌 SELL → 匹配 sell 锁定（锁定方是买方，挂牌方是卖方）
	// 挂牌 BUY → 匹配 buy 锁定（挂牌方是买方，锁定方是卖方）
	var lockSide string
	if listing.Side == "SELL" {
		lockSide = "sell"
	} else {
		lockSide = "buy"
	}

	// 查询匹配的 ACTIVE 换盘锁单
	rows, err := h.pool.Query(ctx,
		`SELECT sm.id, sm.swap_a_id, sm.acceptor_id, sm.matched_qty,
		         sl.serial_no, sl.user_id AS swap_user_id,
		         sl.sell_product_id, sl.sell_price, sl.sell_delivery_period, sl.sell_delivery_location,
		         sl.sell_payment_method, sl.sell_delivery_method, sl.sell_free_storage_enabled, sl.sell_free_storage_days, sl.sell_specs,
		         sl.buy_product_id, sl.buy_price, sl.buy_delivery_period, sl.buy_delivery_location,
		         sl.buy_payment_method, sl.buy_delivery_method, sl.buy_free_storage_enabled, sl.buy_free_storage_days, sl.buy_specs
		  FROM swap_matches sm
		  JOIN swap_listings sl ON sm.swap_a_id = sl.id
		  WHERE sm.lock_status = 'ACTIVE' AND sm.match_side = $1
		    AND sm.acceptor_id != $2
		    AND sl.status = 'OPEN'
		 ORDER BY sm.matched_at ASC`,
		lockSide, listingUserID,
	)
	if err != nil {
		log.Error().Err(err).Msg("#697-6 查询换盘 ACTIVE 锁单失败")
		return
	}
	defer rows.Close()

	type swapLockMatch struct {
		lockID         uuid.UUID
		swapID         uuid.UUID
		acceptorID     uuid.UUID
		qty            float64
		serialNo       int64
		swapUserID     uuid.UUID
		productID      string
		price          float64
		deliveryPeriod *string
		deliveryLoc    *string
		paymentMethod  *string
		deliveryMethod *string
		freeStorageEn  bool
		freeStorageDays *int
		specs          json.RawMessage
	}

	var candidates []swapLockMatch
	for rows.Next() {
		var m swapLockMatch
		var (
			sellProductID, buyProductID           string
			sellPrice, buyPrice                   float64
			sellDP, sellDL, sellPM, sellDM        *string
			sellFSE                                bool
			sellFSD                                *int
			sellSpecs                              json.RawMessage
			buyDP, buyDL, buyPM, buyDM            *string
			buyFSE                                 bool
			buyFSD                                 *int
			buySpecs                               json.RawMessage
		)
		if err := rows.Scan(
			&m.lockID, &m.swapID, &m.acceptorID, &m.qty,
			&m.serialNo, &m.swapUserID,
			&sellProductID, &sellPrice, &sellDP, &sellDL, &sellPM, &sellDM, &sellFSE, &sellFSD, &sellSpecs,
			&buyProductID, &buyPrice, &buyDP, &buyDL, &buyPM, &buyDM, &buyFSE, &buyFSD, &buySpecs,
		); err != nil {
			log.Error().Err(err).Msg("#697-6 扫描换盘锁单行失败")
			continue
		}

		// 根据锁单方向选择对应的腿字段
		if lockSide == "sell" {
			m.productID = sellProductID
			m.price = sellPrice
			m.deliveryPeriod = sellDP
			m.deliveryLoc = sellDL
			m.paymentMethod = sellPM
			m.deliveryMethod = sellDM
			m.freeStorageEn = sellFSE
			m.freeStorageDays = sellFSD
			m.specs = sellSpecs
		} else {
			m.productID = buyProductID
			m.price = buyPrice
			m.deliveryPeriod = buyDP
			m.deliveryLoc = buyDL
			m.paymentMethod = buyPM
			m.deliveryMethod = buyDM
			m.freeStorageEn = buyFSE
			m.freeStorageDays = buyFSD
			m.specs = buySpecs
		}
		candidates = append(candidates, m)
	}

	for _, m := range candidates {
		// 条款完全匹配检查
		if m.productID != listing.ProductID {
			continue
		}
		if m.price != listing.Price {
			continue
		}
		if m.qty > remainingQty {
			continue // 挂牌剩余量不足以匹配锁单数量
		}
		if !ptrStrEqual(m.deliveryPeriod, listing.DeliveryPeriod) {
			continue
		}
		if !ptrStrEqual(m.deliveryLoc, listing.DeliveryLocation) {
			continue
		}
		if !ptrStrEqual(m.paymentMethod, listing.PaymentMethod) {
			continue
		}
		if !ptrStrEqual(m.deliveryMethod, listing.DeliveryMethod) {
			continue
		}
		if m.freeStorageEn != listing.FreeStorageEnabled {
			continue
		}
		if !ptrIntEqual(m.freeStorageDays, listing.FreeStorageDays) {
			continue
		}

		// 黑名单检查
		if h.blacklistRepo != nil {
			blocked, _ := h.blacklistRepo.IsBlocked(ctx, m.acceptorID, listingUserID)
			if blocked {
				continue
			}
			blocked2, _ := h.blacklistRepo.IsBlocked(ctx, listingUserID, m.acceptorID)
			if blocked2 {
				continue
			}
		}

		// 匹配成功 → 开事务执行撮合
		tx, err := h.listingRepo.BeginTx(ctx)
		if err != nil {
			log.Error().Err(err).Msg("#697-6 开启事务失败")
			continue
		}

		// 更新锁单状态为 FLASHED
		_, err = tx.Exec(ctx, `UPDATE swap_matches SET lock_status = 'FLASHED' WHERE id = $1 AND lock_status = 'ACTIVE'`, m.lockID)
		if err != nil {
			tx.Rollback(ctx)
			log.Error().Err(err).Msg("#697-6 更新锁单状态失败")
			continue
		}

		// 更新挂牌已成交量
		if err := h.listingRepo.AddFilledTx(ctx, tx, listing.ID, m.qty); err != nil {
			tx.Rollback(ctx)
			log.Error().Err(err).Msg("#697-6 更新挂牌已成交量失败")
			continue
		}

		// 生成 trade 记录
		var (
			buyerID, sellerID uuid.UUID
			buySerialNo      *int64
			sellSerialNo     *int64
			buySpecs         json.RawMessage
			sellSpecs        json.RawMessage
		)
		listingSerialNo := listing.SerialNo
		if lockSide == "sell" {
			// sell 锁定：挂牌方是卖方，锁定方是买方
			buyerID = m.acceptorID
			sellerID = listingUserID
			buySerialNo = &m.serialNo
			sellSerialNo = &listingSerialNo
			buySpecs = m.specs
			sellSpecs = normalizeSpecs(listing.Specs)
		} else {
			// buy 锁定：挂牌方是买方，锁定方是卖方
			buyerID = listingUserID
			sellerID = m.acceptorID
			buySerialNo = &listingSerialNo
			sellSerialNo = &m.serialNo
			buySpecs = normalizeSpecs(listing.Specs)
			sellSpecs = m.specs
		}

		trade := &repo.Trade{
			ProductID:          listing.ProductID,
			BuyOrderID:         listing.ID,
			SellOrderID:        m.swapID,
			BuyUserID:          buyerID,
			SellUserID:         sellerID,
			Price:              listing.Price,
			Quantity:           m.qty,
			DeliveryPeriod:     listing.DeliveryPeriod,
			DeliveryLocation:   listing.DeliveryLocation,
			BuySerialNo:        buySerialNo,
			SellSerialNo:       sellSerialNo,
			BuyPaymentMethod:   listing.PaymentMethod,
			SellPaymentMethod:  listing.PaymentMethod,
			DeliveryMethod:     listing.DeliveryMethod,
			FreeStorageEnabled: &listing.FreeStorageEnabled,
			FreeStorageDays:    listing.FreeStorageDays,
			BuySpecs:           buySpecs,
			SellSpecs:          sellSpecs,
			Source:             "swap",
			AggressorUserID:    &listingUserID,
		}

		if h.tradeRepo != nil {
			if err := h.tradeRepo.CreateTx(ctx, tx, trade); err != nil {
				tx.Rollback(ctx)
				log.Error().Err(err).Msg("#697-6 写入成交记录失败")
				continue
			}
		}

		if err := tx.Commit(ctx); err != nil {
			log.Error().Err(err).Msg("#697-6 提交事务失败")
			continue
		}

		// 成交后资金结算
		if h.accountRepo != nil {
			if err := h.accountRepo.SettleTrade(ctx, buyerID, sellerID, listing.ID, trade.ID, listing.Price, m.qty); err != nil {
				log.Error().Err(err).Str("trade_id", trade.ID.String()).Msg("#697-6 成交资金结算失败")
			}
		}

		// 更新本地剩余量
		remainingQty -= m.qty

		// 推送成交消息到 WebSocket
		if h.broadcast != nil {
			h.broadcast <- engine.Trade{
				ID:              trade.ID.String(),
				BuyOrder:        trade.BuyOrderID.String(),
				SellOrder:       trade.SellOrderID.String(),
				ProductID:       trade.ProductID,
				Price:           trade.Price,
				Quantity:        trade.Quantity,
				Timestamp:       trade.TradedAt,
				Source:          "swap",
				BuyUserID:       buyerID.String(),
				SellUserID:      sellerID.String(),
				AggressorUserID: listingUserID.String(),
				ListingUserID:   listingUserID.String(),
			}
		}

		// 通知换盘锁单方：您的锁单已被普通挂牌撮合
		if h.wsPush != nil {
			h.wsPush(m.acceptorID, "swap_lock_matched_by_listing", map[string]interface{}{
				"swap_id":     m.swapID,
				"lock_id":     m.lockID,
				"listing_id":  listing.ID,
				"match_qty":   m.qty,
				"match_side":  lockSide,
				"product_id":  listing.ProductID,
			})
		}

		log.Info().
			Str("listing_id", listing.ID.String()).
			Str("swap_id", m.swapID.String()).
			Str("lock_id", m.lockID.String()).
			Str("side", lockSide).
			Float64("qty", m.qty).
			Msg("#697-6 普通挂牌与换盘锁单自动撮合成功")

		// 更新 listing 的 filled 量（用于后续返回）
		listing.Filled += m.qty

		if remainingQty <= 0 {
			break
		}
	}
}

// matchListingWithOpenSwapLegs #697-6b：挂牌对接换盘「对侧已超前」的单边，齐步完成换盘
//
// 规则：换盘必须双侧齐步。若卖腿已锁/已成 33、买腿仅 0，则 SELL 挂牌只能补买腿最多 33 吨；
// 不可把挂牌剩余量一侧吃光。成交量 = min(挂牌剩余, 本腿剩余, 对侧超前量)，并对冲对侧 ACTIVE 锁。
func (h *ListingHandler) matchListingWithOpenSwapLegs(ctx context.Context, listing *repo.Listing, remainingQty float64, listingUserID uuid.UUID) {
	if h.pool == nil || remainingQty <= 0 {
		return
	}

	// 挂牌 SELL → 补换盘买腿；挂牌 BUY → 补换盘卖腿
	leg := "buy"
	oppLeg := "sell"
	if strings.ToUpper(listing.Side) == "BUY" {
		leg = "sell"
		oppLeg = "buy"
	}

	type swapCand struct {
		id                                  uuid.UUID
		userID                              uuid.UUID
		serialNo                            int64
		price                               float64
		remain                              float64
		allowPartial                        bool
		minQty                              float64
		deliveryPeriod                      *string
		deliveryLoc                         *string
		paymentMethod                       *string
		deliveryMethod                      *string
		freeStorageEn                       bool
		freeStorageDays                     *int
		specs                               json.RawMessage
		sellFilled, buyFilled               float64
		sellQty, buyQty                     float64
		// 对侧腿（用于闪烁对侧锁后写双侧成交）
		oppProduct                          string
		oppPrice                            float64
		oppDP, oppDL, oppPM, oppDM          *string
		oppFSEn                             bool
		oppFSD                              *int
		oppSpecs                            json.RawMessage
	}

	var q string
	if leg == "buy" {
		// 买腿条款 + 卖腿完整信息（齐步对冲卖侧锁）
		q = `SELECT id, user_id, serial_no, buy_price,
		            (buy_quantity - buy_filled) AS remain,
		            buy_allow_partial, buy_min_quantity,
		            buy_delivery_period, buy_delivery_location, buy_payment_method, buy_delivery_method,
		            buy_free_storage_enabled, buy_free_storage_days, buy_specs,
		            sell_filled, buy_filled, sell_quantity, buy_quantity,
		            sell_product_id, sell_price,
		            sell_delivery_period, sell_delivery_location, sell_payment_method, sell_delivery_method,
		            sell_free_storage_enabled, sell_free_storage_days, sell_specs
		     FROM swap_listings
		     WHERE status = 'OPEN' AND buy_product_id = $1 AND buy_price = $2
		       AND (buy_quantity - buy_filled) > 0 AND user_id != $3
		       AND sell_filled > buy_filled
		     ORDER BY created_at ASC`
	} else {
		q = `SELECT id, user_id, serial_no, sell_price,
		            (sell_quantity - sell_filled) AS remain,
		            sell_allow_partial, sell_min_quantity,
		            sell_delivery_period, sell_delivery_location, sell_payment_method, sell_delivery_method,
		            sell_free_storage_enabled, sell_free_storage_days, sell_specs,
		            sell_filled, buy_filled, sell_quantity, buy_quantity,
		            buy_product_id, buy_price,
		            buy_delivery_period, buy_delivery_location, buy_payment_method, buy_delivery_method,
		            buy_free_storage_enabled, buy_free_storage_days, buy_specs
		     FROM swap_listings
		     WHERE status = 'OPEN' AND sell_product_id = $1 AND sell_price = $2
		       AND (sell_quantity - sell_filled) > 0 AND user_id != $3
		       AND buy_filled > sell_filled
		     ORDER BY created_at ASC`
	}

	rows, err := h.pool.Query(ctx, q, listing.ProductID, listing.Price, listingUserID)
	if err != nil {
		log.Error().Err(err).Msg("#697-6b 查询换盘剩余单边失败")
		return
	}
	defer rows.Close()

	var cands []swapCand
	for rows.Next() {
		var m swapCand
		if err := rows.Scan(
			&m.id, &m.userID, &m.serialNo, &m.price, &m.remain,
			&m.allowPartial, &m.minQty,
			&m.deliveryPeriod, &m.deliveryLoc, &m.paymentMethod, &m.deliveryMethod,
			&m.freeStorageEn, &m.freeStorageDays, &m.specs,
			&m.sellFilled, &m.buyFilled, &m.sellQty, &m.buyQty,
			&m.oppProduct, &m.oppPrice,
			&m.oppDP, &m.oppDL, &m.oppPM, &m.oppDM, &m.oppFSEn, &m.oppFSD, &m.oppSpecs,
		); err != nil {
			continue
		}
		cands = append(cands, m)
	}

	for _, m := range cands {
		if remainingQty <= 0 {
			break
		}
		if !deliveryPeriodEqual(m.deliveryPeriod, listing.DeliveryPeriod) ||
			!ptrStrEqualLoose(m.deliveryLoc, listing.DeliveryLocation) ||
			!ptrStrEqualLoose(m.paymentMethod, listing.PaymentMethod) ||
			!ptrStrEqualLoose(m.deliveryMethod, listing.DeliveryMethod) ||
			m.freeStorageEn != listing.FreeStorageEnabled ||
			!ptrIntEqual(m.freeStorageDays, listing.FreeStorageDays) {
			continue
		}
		if h.blacklistRepo != nil {
			b1, _ := h.blacklistRepo.IsBlocked(ctx, m.userID, listingUserID)
			b2, _ := h.blacklistRepo.IsBlocked(ctx, listingUserID, m.userID)
			if b1 || b2 {
				continue
			}
		}

		// 对侧超前量：只能齐步补齐，不可一侧独吃
		pairRoom := m.sellFilled - m.buyFilled
		if leg == "sell" {
			pairRoom = m.buyFilled - m.sellFilled
		}
		if pairRoom <= 0 {
			continue
		}
		capRemain := math.Min(m.remain, pairRoom)
		qty, ok := computeCrossFillQty(remainingQty, listing.MinQuantity, listing.AllowPartial, capRemain, m.minQty, m.allowPartial)
		if !ok || qty <= 0 {
			continue
		}

		tx, err := h.listingRepo.BeginTx(ctx)
		if err != nil {
			continue
		}

		var tag interface{ RowsAffected() int64 }
		if leg == "buy" {
			tag, err = tx.Exec(ctx,
				`UPDATE swap_listings SET
				    buy_filled = buy_filled + $2,
				    status = CASE
				      WHEN sell_filled >= sell_quantity AND buy_filled + $2 >= buy_quantity THEN 'MATCHED'
				      ELSE 'OPEN' END,
				    updated_at = NOW()
				 WHERE id = $1 AND status = 'OPEN'
				   AND (buy_quantity - buy_filled) >= $2
				   AND (sell_filled - buy_filled) >= $2`,
				m.id, qty)
		} else {
			tag, err = tx.Exec(ctx,
				`UPDATE swap_listings SET
				    sell_filled = sell_filled + $2,
				    status = CASE
				      WHEN sell_filled + $2 >= sell_quantity AND buy_filled >= buy_quantity THEN 'MATCHED'
				      ELSE 'OPEN' END,
				    updated_at = NOW()
				 WHERE id = $1 AND status = 'OPEN'
				   AND (sell_quantity - sell_filled) >= $2
				   AND (buy_filled - sell_filled) >= $2`,
				m.id, qty)
		}
		if err != nil || tag == nil || tag.RowsAffected() == 0 {
			tx.Rollback(ctx)
			continue
		}

		if err := h.listingRepo.AddFilledTx(ctx, tx, listing.ID, qty); err != nil {
			tx.Rollback(ctx)
			continue
		}

		// 对冲对侧 ACTIVE 锁（FIFO），并写对侧腿成交
		// 若对侧超前来自已 FLASH 的历史（无 ACTIVE 锁），则只写本侧挂牌成交即可
		oppTrades, oppConsumed, err := consumeOppositeActiveLocks(
			ctx, tx, m.id, m.userID, m.serialNo, oppLeg, qty,
			m.oppProduct, m.oppPrice, m.oppDP, m.oppDL, m.oppPM, m.oppDM, m.oppFSEn, m.oppFSD, m.oppSpecs,
		)
		if err != nil {
			tx.Rollback(ctx)
			continue
		}
		if oppConsumed > 0 && oppConsumed+1e-9 < qty {
			tx.Rollback(ctx)
			log.Warn().
				Str("swap_id", m.id.String()).
				Float64("need", qty).
				Float64("opp_consumed", oppConsumed).
				Msg("#697-6b 对侧锁只能部分覆盖，跳过")
			continue
		}

		matchID := uuid.New()
		_, _ = tx.Exec(ctx,
			`INSERT INTO swap_matches (id, swap_a_id, swap_b_id, product_id, acceptor_id, matched_qty, matched_at, match_side, lock_status)
			 VALUES ($1, $2, NULL, $3, $4, $5, NOW(), $6, 'FLASHED')`,
			matchID, m.id, listing.ProductID, listingUserID, qty, leg,
		)

		listingSerial := listing.SerialNo
		swapSerial := m.serialNo
		var listingTrade *repo.Trade
		if leg == "buy" {
			listingTrade = &repo.Trade{
				ProductID: listing.ProductID, BuyOrderID: listing.ID, SellOrderID: m.id,
				BuyUserID: m.userID, SellUserID: listingUserID, Price: listing.Price, Quantity: qty,
				DeliveryPeriod: listing.DeliveryPeriod, DeliveryLocation: listing.DeliveryLocation,
				BuySerialNo: &swapSerial, SellSerialNo: &listingSerial,
				BuyPaymentMethod: listing.PaymentMethod, SellPaymentMethod: listing.PaymentMethod,
				DeliveryMethod: listing.DeliveryMethod, FreeStorageEnabled: &listing.FreeStorageEnabled,
				FreeStorageDays: listing.FreeStorageDays,
				BuySpecs: m.specs, SellSpecs: normalizeSpecs(listing.Specs),
				Source: repo.TradeSourceSwap, AggressorUserID: &listingUserID,
			}
		} else {
			listingTrade = &repo.Trade{
				ProductID: listing.ProductID, BuyOrderID: listing.ID, SellOrderID: m.id,
				BuyUserID: listingUserID, SellUserID: m.userID, Price: listing.Price, Quantity: qty,
				DeliveryPeriod: listing.DeliveryPeriod, DeliveryLocation: listing.DeliveryLocation,
				BuySerialNo: &listingSerial, SellSerialNo: &swapSerial,
				BuyPaymentMethod: listing.PaymentMethod, SellPaymentMethod: listing.PaymentMethod,
				DeliveryMethod: listing.DeliveryMethod, FreeStorageEnabled: &listing.FreeStorageEnabled,
				FreeStorageDays: listing.FreeStorageDays,
				BuySpecs: normalizeSpecs(listing.Specs), SellSpecs: m.specs,
				Source: repo.TradeSourceSwap, AggressorUserID: &listingUserID,
			}
		}

		allTrades := append([]*repo.Trade{listingTrade}, oppTrades...)
		okWrite := true
		if h.tradeRepo != nil {
			for _, tr := range allTrades {
				if err := h.tradeRepo.CreateTx(ctx, tx, tr); err != nil {
					okWrite = false
					log.Error().Err(err).Msg("#697-6b 写入成交失败")
					break
				}
			}
		}
		if !okWrite {
			tx.Rollback(ctx)
			continue
		}
		if err := tx.Commit(ctx); err != nil {
			continue
		}

		for _, tr := range allTrades {
			if h.accountRepo != nil && tr.ID != uuid.Nil {
				_ = h.accountRepo.SettleTrade(ctx, tr.BuyUserID, tr.SellUserID, listing.ID, tr.ID, tr.Price, tr.Quantity)
			}
			if h.broadcast != nil && tr.ID != uuid.Nil {
				et := engine.Trade{
					ID: tr.ID.String(), BuyOrder: tr.BuyOrderID.String(), SellOrder: tr.SellOrderID.String(),
					ProductID: tr.ProductID, Price: tr.Price, Quantity: tr.Quantity,
					Timestamp: tr.TradedAt, Source: tr.Source,
					BuyUserID: tr.BuyUserID.String(), SellUserID: tr.SellUserID.String(),
					ListingUserID: listingUserID.String(),
				}
				if tr.AggressorUserID != nil {
					et.AggressorUserID = tr.AggressorUserID.String()
				}
				h.broadcast <- et
			}
		}
		if h.wsPush != nil {
			h.wsPush(m.userID, "swap_leg_matched_by_listing", map[string]interface{}{
				"swap_id": m.id, "listing_id": listing.ID, "match_qty": qty, "match_side": leg, "product_id": listing.ProductID,
			})
		}

		remainingQty -= qty
		listing.Filled += qty
		log.Info().
			Str("listing_id", listing.ID.String()).
			Str("swap_id", m.id.String()).
			Str("leg", leg).
			Float64("qty", qty).
			Float64("pair_room", pairRoom).
			Msg("#697-6b 挂牌与换盘齐步自动撮合成功")
	}
}

// consumeOppositeActiveLocks FIFO 消耗对侧 ACTIVE 锁并构造对侧腿成交
func consumeOppositeActiveLocks(
	ctx context.Context, tx pgx.Tx,
	swapID, swapUserID uuid.UUID, swapSerial int64, oppLeg string, need float64,
	oppProduct string, oppPrice float64,
	oppDP, oppDL, oppPM, oppDM *string, oppFSEn bool, oppFSD *int, oppSpecs json.RawMessage,
) ([]*repo.Trade, float64, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, acceptor_id, matched_qty FROM swap_matches
		 WHERE swap_a_id = $1 AND lock_status = 'ACTIVE' AND match_side = $2
		 ORDER BY matched_at ASC FOR UPDATE`,
		swapID, oppLeg,
	)
	if err != nil {
		return nil, 0, err
	}
	type lk struct {
		id         uuid.UUID
		acceptorID uuid.UUID
		qty        float64
	}
	var locks []lk
	for rows.Next() {
		var x lk
		if rows.Scan(&x.id, &x.acceptorID, &x.qty) != nil {
			continue
		}
		locks = append(locks, x)
	}
	rows.Close()

	var trades []*repo.Trade
	consumed := 0.0
	left := need
	for _, x := range locks {
		if left <= 0 {
			break
		}
		take := math.Min(x.qty, left)
		if take+1e-9 >= x.qty {
			if _, err := tx.Exec(ctx, `UPDATE swap_matches SET lock_status='FLASHED' WHERE id=$1 AND lock_status='ACTIVE'`, x.id); err != nil {
				return nil, consumed, err
			}
		} else {
			if _, err := tx.Exec(ctx, `UPDATE swap_matches SET matched_qty = matched_qty - $2 WHERE id=$1 AND lock_status='ACTIVE'`, x.id, take); err != nil {
				return nil, consumed, err
			}
		}

		ss := swapSerial
		var buyerID, sellerID uuid.UUID
		if oppLeg == "sell" {
			// sell 锁：锁定方是买方，发起方是卖方
			buyerID = x.acceptorID
			sellerID = swapUserID
		} else {
			buyerID = swapUserID
			sellerID = x.acceptorID
		}
		fs := oppFSEn
		tr := &repo.Trade{
			ProductID: oppProduct, BuyOrderID: x.id, SellOrderID: swapID,
			BuyUserID: buyerID, SellUserID: sellerID, Price: oppPrice, Quantity: take,
			DeliveryPeriod: oppDP, DeliveryLocation: oppDL,
			BuySerialNo: &ss, SellSerialNo: &ss,
			BuyPaymentMethod: oppPM, SellPaymentMethod: oppPM, DeliveryMethod: oppDM,
			FreeStorageEnabled: &fs, FreeStorageDays: oppFSD,
			BuySpecs: oppSpecs, SellSpecs: oppSpecs,
			Source: repo.TradeSourceSwap, AggressorUserID: &x.acceptorID,
		}
		trades = append(trades, tr)
		consumed += take
		left -= take
	}
	return trades, consumed, nil
}

// MatchOpenSwapWithListings 换盘创建/更新后：仅当一侧已超前时，用挂牌齐步补另一侧
func (h *ListingHandler) MatchOpenSwapWithListings(ctx context.Context, swapID uuid.UUID) {
	if h.pool == nil {
		return
	}
	var (
		userID                              uuid.UUID
		status                              string
		sellProduct, buyProduct             string
		sellPrice, buyPrice                 float64
		sellQty, buyQty, sellFilled, buyFilled float64
		sellDP, sellDL, sellPM, sellDM      *string
		buyDP, buyDL, buyPM, buyDM          *string
		sellFSEn, buyFSEn                   bool
		sellFSD, buyFSD                     *int
	)
	err := h.pool.QueryRow(ctx,
		`SELECT user_id, status,
		        sell_product_id, sell_price, sell_quantity, sell_filled,
		        sell_delivery_period, sell_delivery_location, sell_payment_method, sell_delivery_method,
		        sell_free_storage_enabled, sell_free_storage_days,
		        buy_product_id, buy_price, buy_quantity, buy_filled,
		        buy_delivery_period, buy_delivery_location, buy_payment_method, buy_delivery_method,
		        buy_free_storage_enabled, buy_free_storage_days
		 FROM swap_listings WHERE id = $1`, swapID,
	).Scan(
		&userID, &status,
		&sellProduct, &sellPrice, &sellQty, &sellFilled,
		&sellDP, &sellDL, &sellPM, &sellDM, &sellFSEn, &sellFSD,
		&buyProduct, &buyPrice, &buyQty, &buyFilled,
		&buyDP, &buyDL, &buyPM, &buyDM, &buyFSEn, &buyFSD,
	)
	if err != nil || status != "OPEN" {
		return
	}

	// 卖侧超前 → 找条款匹配的 SELL 挂牌来补买腿
	if sellFilled > buyFilled {
		h.scanListingsForSwapLeg(ctx, userID, "SELL", buyProduct, buyPrice, buyDP, buyDL, buyPM, buyDM, buyFSEn, buyFSD)
	}
	// 买侧超前 → 找条款匹配的 BUY 挂牌来补卖腿
	_ = h.pool.QueryRow(ctx, `SELECT status, sell_filled, buy_filled FROM swap_listings WHERE id=$1`, swapID).
		Scan(&status, &sellFilled, &buyFilled)
	if status == "OPEN" && buyFilled > sellFilled {
		h.scanListingsForSwapLeg(ctx, userID, "BUY", sellProduct, sellPrice, sellDP, sellDL, sellPM, sellDM, sellFSEn, sellFSD)
	}
}

func (h *ListingHandler) scanListingsForSwapLeg(
	ctx context.Context, swapUserID uuid.UUID, listingSide, productID string, price float64,
	dp, dl, pm, dm *string, fsEn bool, fsDays *int,
) {
	rows, err := h.pool.Query(ctx,
		`SELECT id FROM listings
		 WHERE status IN ('OPEN','PARTIAL') AND product_id = $1 AND side = $2 AND price = $3
		   AND (quantity - filled) > 0 AND user_id != $4
		 ORDER BY created_at ASC LIMIT 50`,
		productID, listingSide, price, swapUserID,
	)
	if err != nil {
		return
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	for _, id := range ids {
		listing, err := h.listingRepo.FindByID(ctx, id)
		if err != nil || listing == nil {
			continue
		}
		if !deliveryPeriodEqual(dp, listing.DeliveryPeriod) ||
			!ptrStrEqualLoose(dl, listing.DeliveryLocation) ||
			!ptrStrEqualLoose(pm, listing.PaymentMethod) ||
			!ptrStrEqualLoose(dm, listing.DeliveryMethod) ||
			fsEn != listing.FreeStorageEnabled ||
			!ptrIntEqual(fsDays, listing.FreeStorageDays) {
			continue
		}
		remain := listing.Quantity - listing.Filled
		if remain <= 0 {
			continue
		}
		before := listing.Filled
		h.matchListingWithOpenSwapLegs(ctx, listing, remain, listing.UserID)
		if listing.Filled > before {
			listing.Status = listingStatusFromFilled(listing.Quantity, listing.Filled, listing.Status)
			_ = h.listingRepo.UpdateFilled(ctx, listing.ID, listing.Filled, listing.Status)
			h.syncEngineListing(listing)
		}
	}
}

// ReconcileSwapListingCrossMatches 启动时回补：对仍有剩余量的挂牌尝试对接换盘齐步单边
func (h *ListingHandler) ReconcileSwapListingCrossMatches(ctx context.Context) {
	if h.pool == nil {
		return
	}
	rows, err := h.pool.Query(ctx,
		`SELECT id FROM listings WHERE status IN ('OPEN','PARTIAL') AND quantity > filled
		 ORDER BY created_at ASC LIMIT 500`)
	if err != nil {
		return
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	for _, id := range ids {
		listing, err := h.listingRepo.FindByID(ctx, id)
		if err != nil || listing == nil {
			continue
		}
		remain := listing.Quantity - listing.Filled
		if remain <= 0 {
			continue
		}
		h.matchListingWithSwapLocks(ctx, listing, remain, listing.UserID)
		remain = listing.Quantity - listing.Filled
		if remain > 0 {
			h.matchListingWithOpenSwapLegs(ctx, listing, remain, listing.UserID)
		}
		if listing.Filled > 0 {
			listing.Status = listingStatusFromFilled(listing.Quantity, listing.Filled, listing.Status)
			_ = h.listingRepo.UpdateFilled(ctx, listing.ID, listing.Filled, listing.Status)
			h.syncEngineListing(listing)
		}
	}
}


func computeCrossFillQty(listingRemain, listingMin float64, listingAllow bool, swapRemain, swapMin float64, swapAllow bool) (float64, bool) {
	if listingRemain <= 0 || swapRemain <= 0 {
		return 0, false
	}
	qty := math.Min(listingRemain, swapRemain)
	if !listingAllow {
		if listingRemain > swapRemain {
			return 0, false
		}
		qty = listingRemain
	}
	if !swapAllow {
		if swapRemain > listingRemain {
			return 0, false
		}
		qty = swapRemain
	}
	// 按份数：对齐到两侧每份数量的最小公倍数倍数
	if listingAllow || swapAllow {
		maxQ := qty
		var step int64 = 1
		if listingAllow && listingMin > 0 {
			step = int64(listingMin)
		}
		if swapAllow && swapMin > 0 {
			mi := int64(swapMin)
			if step <= 1 {
				step = mi
			} else {
				step = step / gcdInt64(step, mi) * mi
			}
		}
		if step > 1 {
			qty = float64(int64(maxQ)/step) * float64(step)
		}
	}
	if listingAllow && listingMin > 0 {
		if msg := validateListingQtyRemain(qty, listingRemain, listingMin, true, ""); msg != "" {
			if listingRemain <= swapRemain && (listingMin <= 0 || listingRemain >= listingMin) {
				qty = listingRemain
			} else {
				return 0, false
			}
		}
	}
	if swapAllow && swapMin > 0 {
		if msg := validateListingQtyRemain(qty, swapRemain, swapMin, true, ""); msg != "" {
			if swapRemain <= listingRemain && (swapMin <= 0 || swapRemain >= swapMin) {
				qty = swapRemain
			} else {
				return 0, false
			}
		}
	}
	if qty <= 0 {
		return 0, false
	}
	return qty, true
}

func gcdInt64(a, b int64) int64 {
	if a < 0 {
		a = -a
	}
	if b < 0 {
		b = -b
	}
	for b != 0 {
		a, b = b, a%b
	}
	if a == 0 {
		return 1
	}
	return a
}

func listingStatusFromFilled(qty, filled float64, fallback repo.ListingStatus) repo.ListingStatus {
	if filled >= qty && qty > 0 {
		return repo.ListingFilled
	}
	if filled > 0 {
		return repo.ListingPartial
	}
	if fallback == repo.ListingFilled || fallback == repo.ListingPartial {
		return repo.ListingOpen
	}
	return fallback
}

func (h *ListingHandler) syncEngineListing(listing *repo.Listing) {
	if h.eng == nil || listing == nil {
		return
	}
	h.eng.CancelOrder(listing.ProductID, listing.ID.String())
	if (listing.Status == repo.ListingOpen || listing.Status == repo.ListingPartial) && listing.Quantity > listing.Filled {
		h.eng.LoadOrder(listingToOrder(listing))
	}
}

// RematchOpenListingBooks 对内存订单簿按时间重挂，补上条款已对齐但未成交的对价盘（如编辑后未重撮）
func (h *ListingHandler) RematchOpenListingBooks(ctx context.Context) {
	if h.eng == nil {
		return
	}
	productIDs := h.eng.ProductIDs()
	var total int
	for _, productID := range productIDs {
		trades := h.eng.RematchProduct(productID)
		if len(trades) == 0 {
			continue
		}
		// 按首笔成交的交割期写入（同合约撮合，条款一致）
		var dp, dl *string
		if len(trades) > 0 {
			buyID, _ := uuid.Parse(trades[0].BuyOrder)
			if buyListing, err := h.listingRepo.FindByID(ctx, buyID); err == nil && buyListing != nil {
				dp = buyListing.DeliveryPeriod
				dl = buyListing.DeliveryLocation
			}
		}
		h.persistTrades(ctx, trades, dp, dl, "auto", uuid.Nil)
		total += len(trades)
		log.Info().Str("product_id", productID).Int("trades", len(trades)).Msg("挂牌订单簿重撮完成")
	}
	if total > 0 {
		log.Info().Int("total_trades", total).Msg("RematchOpenListingBooks 完成")
	}
}

func deliveryPeriodEqual(a, b *string) bool {
	return normalizeDeliveryPeriodPtr(a) == normalizeDeliveryPeriodPtr(b)
}

func normalizeDeliveryPeriodPtr(p *string) string {
	if p == nil {
		return "现货"
	}
	s := strings.TrimSpace(*p)
	if s == "" || s == "现货" {
		return "现货"
	}
	return s
}

func ptrStrEqualLoose(a, b *string) bool {
	sa, sb := "", ""
	if a != nil {
		sa = strings.TrimSpace(*a)
	}
	if b != nil {
		sb = strings.TrimSpace(*b)
	}
	return sa == sb
}

func negotiableTermsChanged(existing json.RawMessage, reqTerms []string, reqAllow, existingAllow bool) bool {
	if reqAllow != existingAllow {
		return true
	}
	var old []string
	if len(existing) > 0 {
		_ = json.Unmarshal(existing, &old)
	}
	if !reqAllow {
		return len(old) > 0
	}
	newTerms := reqTerms
	if len(newTerms) == 0 {
		newTerms = defaultNegotiableTerms()
	}
	if len(old) != len(newTerms) {
		return true
	}
	set := make(map[string]struct{}, len(old))
	for _, k := range old {
		set[k] = struct{}{}
	}
	for _, k := range newTerms {
		if _, ok := set[k]; !ok {
			return true
		}
	}
	return false
}

// decodeTermsJSON 将请求中的可议条款 RawMessage 解为字符串切片
func decodeTermsJSON(raw json.RawMessage) []string {
	if len(raw) == 0 || string(bytes.TrimSpace(raw)) == "null" {
		return nil
	}
	var terms []string
	if err := json.Unmarshal(raw, &terms); err != nil {
		return nil
	}
	return terms
}

// specsTextEqual 比较规格字段（兼容 JSON 字符串 / 纯文本 / null）
func specsTextEqual(a, b json.RawMessage) bool {
	return normalizeSpecsText(a) == normalizeSpecsText(b)
}

func normalizeSpecsText(s json.RawMessage) string {
	if len(s) == 0 {
		return ""
	}
	trimmed := bytes.TrimSpace(s)
	if len(trimmed) == 0 || string(trimmed) == "null" || string(trimmed) == "{}" || string(trimmed) == `""` {
		return ""
	}
	var str string
	if err := json.Unmarshal(trimmed, &str); err == nil {
		return strings.TrimSpace(str)
	}
	return strings.TrimSpace(string(trimmed))
}

func listingCommercialChanged(existing *repo.Listing, req *UpdateListingRequest) bool {
	if existing.Price != req.Price || existing.Quantity != req.Quantity || existing.MinQuantity != req.MinQuantity {
		return true
	}
	if existing.AllowPartial != req.AllowPartial {
		return true
	}
	reqDP := strings.TrimSpace(req.DeliveryPeriod)
	if reqDP == "" {
		reqDP = "现货"
	}
	if normalizeDeliveryPeriodPtr(existing.DeliveryPeriod) != reqDP {
		return true
	}
	if !ptrStrEqualLoose(existing.DeliveryLocation, strPtrOrNil(req.DeliveryLocation)) {
		return true
	}
	if !ptrStrEqualLoose(existing.PaymentMethod, strPtrOrNil(req.PaymentMethod)) {
		return true
	}
	if !ptrStrEqualLoose(existing.DeliveryMethod, strPtrOrNil(req.DeliveryMethod)) {
		return true
	}
	fsEn := true
	if req.FreeStorageEnabled != nil {
		fsEn = *req.FreeStorageEnabled
	}
	if existing.FreeStorageEnabled != fsEn {
		return true
	}
	if fsEn {
		var reqDays *int
		if req.FreeStorageDays != nil && *req.FreeStorageDays > 0 {
			reqDays = req.FreeStorageDays
		} else {
			reqDays = existing.FreeStorageDays
		}
		if !ptrIntEqual(existing.FreeStorageDays, reqDays) {
			return true
		}
	}
	exSpecs := strings.TrimSpace(string(existing.Specs))
	reqSpecs := strings.TrimSpace(string(req.Specs))
	if exSpecs != reqSpecs {
		return true
	}
	return false
}

func strPtrOrNil(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}

// ptrStrEqual 比较两个 *string 是否相等（nil 视为相等）
func ptrStrEqual(a, b *string) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

// ptrIntEqual 比较两个 *int 是否相等（nil 视为相等）
func ptrIntEqual(a, b *int) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}
