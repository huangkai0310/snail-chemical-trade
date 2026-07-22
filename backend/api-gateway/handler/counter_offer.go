package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/middleware"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
	engine "github.com/huangkai0310/snail-chemical-trade/matching-engine"
)

type CounterOfferHandler struct {
	coRepo      *repo.CounterOfferRepo
	listingRepo *repo.ListingRepo
	tradeRepo   *repo.TradeRepo
	accountRepo *repo.AccountRepo
	pool        *pgxpool.Pool
	eng          *engine.Engine
	broadcast    chan<- engine.Trade
	wsPush       func(targetUserID uuid.UUID, msgType string, payload interface{})
	blacklistRepo *repo.BlacklistRepo
}

func NewCounterOfferHandler(
	coRepo *repo.CounterOfferRepo,
	listingRepo *repo.ListingRepo,
	tradeRepo *repo.TradeRepo,
	accountRepo *repo.AccountRepo,
	pool *pgxpool.Pool,
	eng *engine.Engine,
	broadcast chan<- engine.Trade,
) *CounterOfferHandler {
	return &CounterOfferHandler{
		coRepo:      coRepo,
		listingRepo: listingRepo,
		tradeRepo:   tradeRepo,
		accountRepo: accountRepo,
		pool:        pool,
		eng:         eng,
		broadcast:   broadcast,
	}
}

// SetBlacklistRepo 注入黑名单 Repo（用于发起/接受议价前检查黑名单）
func (h *CounterOfferHandler) SetBlacklistRepo(blRepo *repo.BlacklistRepo) {
	h.blacklistRepo = blRepo
}

// SetWSPush 注入 WebSocket 推送函数（用于还价通知）
func (h *CounterOfferHandler) SetWSPush(pushFunc func(targetUserID uuid.UUID, msgType string, payload interface{})) {
	h.wsPush = pushFunc
}

// ========== 创建还价 ==========

type CreateCounterOfferRequest struct {
	RefType       string  `json:"ref_type" binding:"required,oneof=listing swap"`
	RefID         string  `json:"ref_id" binding:"required"`
	Mode          string  `json:"mode"`
	NegotiationGroupID *string `json:"negotiation_group_id"`
	OfferPrice    float64 `json:"offer_price" binding:"required,gt=0"`
	OfferQuantity float64 `json:"offer_quantity" binding:"required,gt=0"`
	// 可协商的其他条款（可选；不传则沿用原盘条款）
	OfferDeliveryPeriod    *string `json:"offer_delivery_period"`
	OfferDeliveryLocation  *string `json:"offer_delivery_location"`
	OfferPaymentMethod     *string `json:"offer_payment_method"`
	OfferDeliveryMethod    *string `json:"offer_delivery_method"`
	OfferFreeStorageEnabled *bool  `json:"offer_free_storage_enabled"`
	OfferFreeStorageDays   *int    `json:"offer_free_storage_days"`
	OfferSpecs             *string `json:"offer_specs"`
}

// mergeNegotiableTermsMaps 合并两腿可商谈条款集合
func mergeNegotiableTermsMaps(a, b map[string]bool) map[string]bool {
	merged := map[string]bool{}
	for k := range a {
		merged[k] = true
	}
	for k := range b {
		merged[k] = true
	}
	return merged
}

// Create 发起还价
// parseNegotiableTerms 解析 listing.negotiable_terms（JSON 数组）为可议条款集合
// 数量 / 交割地 / 规格已停用，不可商谈
func parseNegotiableTerms(raw json.RawMessage) map[string]bool {
	set := map[string]bool{}
	if len(raw) == 0 {
		return set
	}
	var terms []string
	if err := json.Unmarshal(raw, &terms); err == nil {
		for _, t := range terms {
			if isRetiredNegotiableTerm(t) {
				continue
			}
			set[t] = true
		}
	}
	return set
}

func isRetiredNegotiableTerm(t string) bool {
	switch t {
	case "quantity", "delivery_location", "specs":
		return true
	default:
		return false
	}
}

func sanitizeNegotiableTermList(terms []string) []string {
	if len(terms) == 0 {
		return terms
	}
	out := make([]string, 0, len(terms))
	seen := map[string]bool{}
	for _, t := range terms {
		if t == "" || isRetiredNegotiableTerm(t) || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	return out
}

// defaultNegotiableTerms 新建发盘默认可商谈条款（不含数量/交割地/规格）
func defaultNegotiableTerms() []string {
	return []string{"price", "delivery_period", "payment_method", "delivery_method", "free_storage"}
}

func sanitizeNegotiableTermsJSON(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || !json.Valid(raw) {
		return json.RawMessage(`[]`)
	}
	var terms []string
	if err := json.Unmarshal(raw, &terms); err != nil {
		return json.RawMessage(`[]`)
	}
	cleaned := sanitizeNegotiableTermList(terms)
	out, err := json.Marshal(cleaned)
	if err != nil {
		return json.RawMessage(`[]`)
	}
	return out
}

// strOrEmpty 安全解引用 *string
func strOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// floatApproxEqual 浮点数容差比较（避免精度差异导致"不可议"误判）
func floatApproxEqual(a, b float64) bool {
	diff := a - b
	if diff < 0 {
		diff = -diff
	}
	// 容差：绝对值差 < 0.01 或相对差 < 0.001%
	if diff < 0.01 {
		return true
	}
	base := a
	if b > a {
		base = b
	}
	if base > 0 {
		return diff/base < 0.00001
	}
	return false
}

// validateListingNegotiable 校验发盘发起的议价条款是否在 listing 允许的可议范围内。
// 允许「沿用原盘值」；仅当某条款被修改为不同值且该条款不在可议范围时才拒绝。
// 返回 (错误信息, ok)；ok=false 表示应拒绝该议价。
func validateListingNegotiable(target *repo.Listing, req CreateCounterOfferRequest) (string, bool) {
	if !target.AllowCounterOffer {
		return "该挂牌不可议价", false
	}
	allowed := parseNegotiableTerms(target.NegotiableTerms)

	// 价格：不可议时只能沿用原价（浮点容差比较，避免精度差异误判）
	if !allowed["price"] && !floatApproxEqual(req.OfferPrice, target.Price) {
		return "该挂牌不可议「价格」", false
	}
	// 数量：不可议时只能沿用剩余量（浮点容差比较）
	remaining := target.Quantity - target.Filled
	if !allowed["quantity"] && !floatApproxEqual(req.OfferQuantity, remaining) {
		return "该挂牌不可议「数量」", false
	}

	// 原盘可选条款当前值
	origSpecs := strings.TrimSpace(string(target.Specs))
	checks := []struct {
		key     string
		label   string
		offered string
		orig    string
		// hasOffer 是否传了该条款报价（nil 表示未传=沿用原盘，不触发校验）
		hasOffer bool
	}{
		{"delivery_period", "交割期", strOrEmpty(req.OfferDeliveryPeriod), strOrEmpty(target.DeliveryPeriod), req.OfferDeliveryPeriod != nil},
		{"delivery_location", "交割地", strOrEmpty(req.OfferDeliveryLocation), strOrEmpty(target.DeliveryLocation), req.OfferDeliveryLocation != nil},
		{"payment_method", "付款方式", strOrEmpty(req.OfferPaymentMethod), strOrEmpty(target.PaymentMethod), req.OfferPaymentMethod != nil},
		{"delivery_method", "交割方式", strOrEmpty(req.OfferDeliveryMethod), strOrEmpty(target.DeliveryMethod), req.OfferDeliveryMethod != nil},
		{"specs", "规格", strOrEmpty(req.OfferSpecs), origSpecs, req.OfferSpecs != nil},
	}
	for _, c := range checks {
		// 仅当议价方确实传了该条款报价（非 nil）且条款不在可议范围时才校验
		// 未传（nil）= 沿用原盘，不应触发"不可议"错误
		if c.hasOffer && !allowed[c.key] && strings.TrimSpace(c.offered) != strings.TrimSpace(c.orig) {
			return fmt.Sprintf("该挂牌不可议「%s」", c.label), false
		}
	}
	// 免仓期：不可议时只能沿用原盘免仓设置
	// 仅当议价方确实传了免仓报价（非 nil）时才校验；未传=沿用原盘
	if req.OfferFreeStorageEnabled != nil && !allowed["free_storage"] {
		offeredFS := *req.OfferFreeStorageEnabled
		if offeredFS != target.FreeStorageEnabled {
			return "该挂牌不可议「免仓期」", false
		}
		offeredDays := 0
		if req.OfferFreeStorageDays != nil {
			offeredDays = *req.OfferFreeStorageDays
		}
		origDays := 0
		if target.FreeStorageDays != nil {
			origDays = *target.FreeStorageDays
		}
		if offeredDays != origDays {
			return "该挂牌不可议「免仓期」", false
		}
	}
	return "", true
}

// validateSwapNegotiable 校验换盘发起的议价条款是否在 swap 允许的可议范围内。
// 与 validateListingNegotiable 逻辑一致，但换盘的条款按 mode 对应腿取值。
// 返回 (错误信息, ok)；ok=false 表示应拒绝该议价。
func validateSwapNegotiable(
	allowed map[string]bool,
	mode string,
	sellPrice, buyPrice, sellQty, buyQty, sellFilled, buyFilled float64,
	sellDP, sellDL, sellPM, sellDM *string,
	sellFSE *bool, sellFSD *int,
	buyDP, buyDL, buyPM, buyDM *string,
	buyFSE *bool, buyFSD *int,
	req CreateCounterOfferRequest,
) (string, bool) {
	// 按 mode 确定参考腿
	var refPrice, refRemain float64
	switch mode {
	case "sell":
		refPrice = sellPrice
		refRemain = sellQty - sellFilled
	case "buy":
		refPrice = buyPrice
		refRemain = buyQty - buyFilled
	default: // both
		refPrice = sellPrice
		refRemain = sellQty - sellFilled
		if remainBuy := buyQty - buyFilled; remainBuy < refRemain {
			refRemain = remainBuy
		}
	}

	// 价格
	if !allowed["price"] && !floatApproxEqual(req.OfferPrice, refPrice) {
		return "该换盘不可议「价格」", false
	}
	// 数量
	if !allowed["quantity"] && !floatApproxEqual(req.OfferQuantity, refRemain) {
		return "该换盘不可议「数量」", false
	}

	// 取对应腿的原盘可选条款当前值
	var origDP, origDL, origPM, origDM *string
	var origFSE *bool
	var origFSD *int
	if mode == "buy" {
		origDP, origDL, origPM, origDM = buyDP, buyDL, buyPM, buyDM
		origFSE, origFSD = buyFSE, buyFSD
	} else {
		origDP, origDL, origPM, origDM = sellDP, sellDL, sellPM, sellDM
		origFSE, origFSD = sellFSE, sellFSD
	}

	checks := []struct {
		key      string
		label    string
		offered  string
		orig     string
		hasOffer bool
	}{
		{"delivery_period", "交割期", strOrEmpty(req.OfferDeliveryPeriod), strOrEmpty(origDP), req.OfferDeliveryPeriod != nil},
		{"delivery_location", "交割地", strOrEmpty(req.OfferDeliveryLocation), strOrEmpty(origDL), req.OfferDeliveryLocation != nil},
		{"payment_method", "付款方式", strOrEmpty(req.OfferPaymentMethod), strOrEmpty(origPM), req.OfferPaymentMethod != nil},
		{"delivery_method", "交割方式", strOrEmpty(req.OfferDeliveryMethod), strOrEmpty(origDM), req.OfferDeliveryMethod != nil},
	}
	for _, c := range checks {
		if c.hasOffer && !allowed[c.key] && strings.TrimSpace(c.offered) != strings.TrimSpace(c.orig) {
			return fmt.Sprintf("该换盘不可议「%s」", c.label), false
		}
	}

	// 免仓期
	if req.OfferFreeStorageEnabled != nil && !allowed["free_storage"] {
		offeredFS := *req.OfferFreeStorageEnabled
		origFS := false
		if origFSE != nil {
			origFS = *origFSE
		}
		if offeredFS != origFS {
			return "该换盘不可议「免仓期」", false
		}
		offeredDays := 0
		if req.OfferFreeStorageDays != nil {
			offeredDays = *req.OfferFreeStorageDays
		}
		origDays := 0
		if origFSD != nil {
			origDays = *origFSD
		}
		if offeredDays != origDays {
			return "该换盘不可议「免仓期」", false
		}
	}

	return "", true
}

// POST /api/v1/counter-offers
func (h *CounterOfferHandler) Create(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req CreateCounterOfferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 对自由文本字段进行消毒
	if req.OfferDeliveryPeriod != nil {
		s := sanitizeString(*req.OfferDeliveryPeriod, 100)
		req.OfferDeliveryPeriod = &s
	}
	if req.OfferDeliveryLocation != nil {
		s := sanitizeString(*req.OfferDeliveryLocation, 200)
		req.OfferDeliveryLocation = &s
	}
	if req.OfferPaymentMethod != nil {
		s := sanitizeString(*req.OfferPaymentMethod, 100)
		req.OfferPaymentMethod = &s
	}
	if req.OfferDeliveryMethod != nil {
		s := sanitizeString(*req.OfferDeliveryMethod, 50)
		req.OfferDeliveryMethod = &s
	}
	if req.OfferSpecs != nil {
		s := sanitizeString(*req.OfferSpecs, 200)
		req.OfferSpecs = &s
	}

	refID, err := uuid.Parse(req.RefID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ref_id"})
		return
	}

	ctx := c.Request.Context()

	var listingUserID uuid.UUID
	var refPrice float64
	var offererSide string // 还价方相对挂牌的方向：SELL=我方卖(接买盘)，BUY=我方买(接卖盘)
	switch req.RefType {
	case "listing":
		target, err := h.listingRepo.FindByID(ctx, refID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "挂牌不存在"})
			return
		}
		if target.UserID == userID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "不能对自己的挂牌还价"})
			return
		}
		if target.Status != repo.ListingOpen && target.Status != repo.ListingPartial {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该挂牌已不可交易"})
			return
		}
		remaining := target.Quantity - target.Filled
		if req.OfferQuantity > remaining {
			c.JSON(http.StatusBadRequest, gin.H{"error": "还价数量超过剩余可成交量"})
			return
		}
		listingUserID = target.UserID

		// 黑名单检查（双向）：拉黑对方则无法发起议价（与摘牌逻辑一致）
		if h.blacklistRepo != nil {
			dir, _ := h.blacklistRepo.IsBlocked(ctx, userID, listingUserID)
			rev, _ := h.blacklistRepo.IsBlocked(ctx, listingUserID, userID)
			if dir || rev {
				c.JSON(http.StatusForbidden, gin.H{"error": "已拉黑该用户，无法发起议价"})
				return
			}
		}
		refPrice = target.Price
		offererSide = oppositeSide(target.Side) // 买盘→我方卖；卖盘→我方买

		// 校验可议条款范围：仅允许议价 listing 允许的条款（沿用原盘值始终允许）
		if msg, ok := validateListingNegotiable(target, req); !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}

	case "swap":
	var swapUserID uuid.UUID
	var swapStatus string
	var sellAllowCounterOffer, buyAllowCounterOffer bool
	var sellNegotiableTerms, buyNegotiableTerms json.RawMessage
	var sellPrice, buyPrice, sellQty, buyQty, sellFilled, buyFilled float64
	var sellDP, sellDL, sellPM, sellDM, buyDP, buyDL, buyPM, buyDM *string
	var sellFSE, buyFSE *bool
	var sellFSD, buyFSD *int
	err := h.pool.QueryRow(ctx,
		`SELECT user_id, status,
		        sell_allow_counter_offer, sell_negotiable_terms,
		        buy_allow_counter_offer, buy_negotiable_terms,
		        sell_price, buy_price, sell_quantity, buy_quantity, sell_filled, buy_filled,
		        sell_delivery_period, sell_delivery_location, sell_payment_method, sell_delivery_method,
		        sell_free_storage_enabled, sell_free_storage_days,
		        buy_delivery_period, buy_delivery_location, buy_payment_method, buy_delivery_method,
		        buy_free_storage_enabled, buy_free_storage_days
		 FROM swap_listings WHERE id = $1`, refID,
	).Scan(&swapUserID, &swapStatus,
		&sellAllowCounterOffer, &sellNegotiableTerms,
		&buyAllowCounterOffer, &buyNegotiableTerms,
		&sellPrice, &buyPrice, &sellQty, &buyQty, &sellFilled, &buyFilled,
		&sellDP, &sellDL, &sellPM, &sellDM, &sellFSE, &sellFSD,
		&buyDP, &buyDL, &buyPM, &buyDM, &buyFSE, &buyFSD)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "换盘不存在"})
			return
		}
		if swapUserID == userID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "不能对自己的换盘还价"})
			return
		}
		if swapStatus != "OPEN" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该换盘已不可交易"})
			return
		}

		mode := req.Mode
		if mode == "" {
			mode = "both"
		}
		if mode != "sell" && mode != "buy" && mode != "both" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的还盘模式，可选：sell / buy / both"})
			return
		}

		// 按方向校验是否允许商谈
		switch mode {
		case "sell":
			if !sellAllowCounterOffer {
				c.JSON(http.StatusBadRequest, gin.H{"error": "该换盘卖出方不可商谈"})
				return
			}
		case "buy":
			if !buyAllowCounterOffer {
				c.JSON(http.StatusBadRequest, gin.H{"error": "该换盘买入方不可商谈"})
				return
			}
		case "both":
			if !sellAllowCounterOffer && !buyAllowCounterOffer {
				c.JSON(http.StatusBadRequest, gin.H{"error": "该换盘不可商谈"})
				return
			}
		}

		// 校验可议条款范围：按 mode 取对应腿的可商谈条款
		sellTerms := parseNegotiableTerms(sellNegotiableTerms)
		buyTerms := parseNegotiableTerms(buyNegotiableTerms)
		var allowedTerms map[string]bool
		switch mode {
		case "sell":
			allowedTerms = sellTerms
		case "buy":
			allowedTerms = buyTerms
		default:
			allowedTerms = mergeNegotiableTermsMaps(sellTerms, buyTerms)
		}
		if msg, ok := validateSwapNegotiable(allowedTerms, mode,
			sellPrice, buyPrice, sellQty, buyQty, sellFilled, buyFilled,
			sellDP, sellDL, sellPM, sellDM, sellFSE, sellFSD,
			buyDP, buyDL, buyPM, buyDM, buyFSE, buyFSD,
			req,
		); !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}

		remainSell := sellQty - sellFilled
		remainBuy := buyQty - buyFilled
		var maxQty float64
		switch mode {
		case "sell":
			maxQty = remainSell
		case "buy":
			maxQty = remainBuy
		case "both":
			if remainSell < remainBuy {
				maxQty = remainSell
			} else {
				maxQty = remainBuy
			}
		}
		if req.OfferQuantity > maxQty {
			c.JSON(http.StatusBadRequest, gin.H{"error": "还价数量超过剩余可匹配量"})
			return
		}
		listingUserID = swapUserID

		// 黑名单检查（双向）：拉黑对方则无法发起议价（与摘牌逻辑一致）
		if h.blacklistRepo != nil {
			dir, _ := h.blacklistRepo.IsBlocked(ctx, userID, swapUserID)
			rev, _ := h.blacklistRepo.IsBlocked(ctx, swapUserID, userID)
			if dir || rev {
				c.JSON(http.StatusForbidden, gin.H{"error": "已拉黑该用户，无法发起议价"})
				return
			}
		}
		// 参考价：按议价模式取对应腿价格；同时确定还价方方向（接买盘=卖方，接卖盘=买方）
		switch req.Mode {
		case "sell":
			refPrice = sellPrice
			offererSide = "BUY"
		case "buy":
			refPrice = buyPrice
			offererSide = "SELL"
		default:
			if sellPrice >= buyPrice {
				refPrice = sellPrice
			} else {
				refPrice = buyPrice
			}
			offererSide = ""
		}
	}

	co := &repo.CounterOffer{
		RefType:       req.RefType,
		RefID:         refID,
		OfferUserID:   userID,
		ListingUserID: listingUserID,
		OfferPrice:    req.OfferPrice,
		OfferQuantity: req.OfferQuantity,
		// 可协商的其他条款（可选）
		OfferDeliveryPeriod:     req.OfferDeliveryPeriod,
		OfferDeliveryLocation:   req.OfferDeliveryLocation,
		OfferPaymentMethod:      req.OfferPaymentMethod,
		OfferDeliveryMethod:     req.OfferDeliveryMethod,
		OfferFreeStorageEnabled: req.OfferFreeStorageEnabled,
		OfferFreeStorageDays:    req.OfferFreeStorageDays,
		OfferSpecs:              req.OfferSpecs,
	}
	if req.NegotiationGroupID != nil && strings.TrimSpace(*req.NegotiationGroupID) != "" {
		if gid, err := uuid.Parse(strings.TrimSpace(*req.NegotiationGroupID)); err == nil {
			co.NegotiationGroupID = &gid
		}
	}
	if req.RefType == "swap" {
		mode := req.Mode
		if mode == "" {
			mode = "both"
		}
		co.Mode = &mode
	}

	if err := h.coRepo.Create(ctx, co); err != nil {
		log.Error().Err(err).Msg("创建还价失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建还价失败"})
		return
	}

	// WebSocket 通知挂牌方
	if h.wsPush != nil {
		h.wsPush(listingUserID, "counter_offer_received", gin.H{
			"id":             co.ID,
			"ref_type":       co.RefType,
			"ref_id":         co.RefID,
			"offer_user_id":  co.OfferUserID,
			"offer_price":    co.OfferPrice,
			"offer_quantity": co.OfferQuantity,
		})
	}

	warning := offererDisadvantageWarn(req.OfferPrice, offererSide, refPrice)
	resp := gin.H{"data": co}
	if warning != "" {
		resp["warning"] = warning
	}
	c.JSON(http.StatusOK, resp)
}

// ========== 查询收到的还价 ==========

// ListReceived 查询我收到的还价（挂牌方视角）
// GET /api/v1/counter-offers/received?status=PENDING&page=1&page_size=20
func (h *CounterOfferHandler) ListReceived(c *gin.Context) {
	userID := middleware.GetUserID(c)
	status := c.Query("status")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	result, err := h.coRepo.ListReceived(c.Request.Context(), userID, status, page, pageSize)
	if err != nil {
		log.Error().Err(err).Msg("查询收到还价失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	c.JSON(http.StatusOK, result)
}

// ========== 查询发出的还价 ==========

// ListSent 查询我发出的还价（还价方视角）
// GET /api/v1/counter-offers/sent?status=PENDING&page=1&page_size=20
func (h *CounterOfferHandler) ListSent(c *gin.Context) {
	userID := middleware.GetUserID(c)
	status := c.Query("status")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	result, err := h.coRepo.ListSent(c.Request.Context(), userID, status, page, pageSize)
	if err != nil {
		log.Error().Err(err).Msg("查询发出还价失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	c.JSON(http.StatusOK, result)
}

// ========== 查询某个挂牌/换盘下的还价 ==========

// ListByRef 查询某挂牌/换盘下的所有还价
// GET /api/v1/counter-offers/by-ref?ref_type=listing&ref_id=xxx&page=1&page_size=20
func (h *CounterOfferHandler) ListByRef(c *gin.Context) {
	refType := c.Query("ref_type")
	refIDStr := c.Query("ref_id")
	status := c.Query("status")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	if refType == "" || refIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请指定 ref_type 和 ref_id"})
		return
	}
	refID, err := uuid.Parse(refIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ref_id"})
		return
	}

	result, err := h.coRepo.ListByRef(c.Request.Context(), refType, refID, status, page, pageSize)
	if err != nil {
		log.Error().Err(err).Msg("查询还价列表失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	c.JSON(http.StatusOK, result)
}

// ========== 接受还价 ==========

// offeredTermKeys 返回议价方实际提出修改的条款键集合（price/quantity 恒为已议；其余仅统计确有报价的条款）
func offeredTermKeys(co *repo.CounterOffer) []string {
	keys := []string{"price", "quantity"}
	if co.OfferDeliveryPeriod != nil {
		keys = append(keys, "delivery_period")
	}
	if co.OfferDeliveryLocation != nil {
		keys = append(keys, "delivery_location")
	}
	if co.OfferPaymentMethod != nil {
		keys = append(keys, "payment_method")
	}
	if co.OfferDeliveryMethod != nil {
		keys = append(keys, "delivery_method")
	}
	if co.OfferFreeStorageEnabled != nil {
		keys = append(keys, "free_storage")
	}
	if co.OfferSpecs != nil && strings.TrimSpace(*co.OfferSpecs) != "" {
		keys = append(keys, "specs")
	}
	return keys
}

// computeApplyTerms 根据 acceptedTerms（接收方勾选接受的条款键）计算最终成交要采用哪些议价条款。
// 仅当条款键在 acceptedTerms 中且议价方确实提供了该条款报价时，才覆盖原盘；否则沿用原盘。
func computeApplyTerms(co *repo.CounterOffer, acceptedTerms []string) map[string]bool {
	set := map[string]bool{}
	for _, k := range acceptedTerms {
		set[k] = true
	}
	at := func(key string, hasValue bool) bool {
		return set[key] && hasValue
	}
	return map[string]bool{
		"price":             at("price", true),
		"quantity":          at("quantity", true),
		"delivery_period":   at("delivery_period", co.OfferDeliveryPeriod != nil),
		"delivery_location": at("delivery_location", co.OfferDeliveryLocation != nil),
		"payment_method":    at("payment_method", co.OfferPaymentMethod != nil),
		"delivery_method":   at("delivery_method", co.OfferDeliveryMethod != nil),
		"free_storage":      at("free_storage", co.OfferFreeStorageEnabled != nil),
		"specs":             at("specs", co.OfferSpecs != nil && strings.TrimSpace(*co.OfferSpecs) != ""),
	}
}

// covers 判断 accepted 是否覆盖全部 offered（用于区分「全部接受」与「部分接受」）
func covers(accepted, offered []string) bool {
	set := map[string]bool{}
	for _, k := range accepted {
		set[k] = true
	}
	for _, k := range offered {
		if !set[k] {
			return false
		}
	}
	return true
}

// Accept 接受还价
// POST /api/v1/counter-offers/:id/accept
// 对于 listing / swap 类还价均支持条款级部分接受。请求体可带 { accepted_terms: string[] }：
//   - 不传或覆盖全部已议条款 → 立即按议价成交（全接受）
//   - 仅覆盖部分 → 置为 PARTIAL_ACCEPTED，等待发起方二次确认
func (h *CounterOfferHandler) Accept(c *gin.Context) {
	userID := middleware.GetUserID(c)
	coID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的还价 ID"})
		return
	}

	ctx := c.Request.Context()

	co, err := h.coRepo.FindByID(ctx, coID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "还价不存在"})
		return
	}
	if co.ListingUserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "只有挂牌方才能接受还价"})
		return
	}
	if co.Status != repo.COStatusPENDING {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该还价已不可接受"})
		return
	}

	// 黑名单检查（双向）：拉黑对方则无法成交（与摘牌逻辑一致）
	if h.blacklistRepo != nil {
		dir, _ := h.blacklistRepo.IsBlocked(ctx, userID, co.OfferUserID)
		rev, _ := h.blacklistRepo.IsBlocked(ctx, co.OfferUserID, userID)
		if dir || rev {
			c.JSON(http.StatusForbidden, gin.H{"error": "已拉黑该用户，无法成交"})
			return
		}
	}

	// 解析可选的部分接受条款
	var body struct {
		AcceptedTerms []string `json:"accepted_terms"`
	}
	_ = c.ShouldBindJSON(&body)

	if co.RefType == "swap" {
		offered := offeredTermKeys(co)
		fullAccept := len(body.AcceptedTerms) == 0 || covers(body.AcceptedTerms, offered)
		var applyTerms map[string]bool
		if len(body.AcceptedTerms) == 0 {
			applyTerms = computeApplyTerms(co, offered) // 全接受：采用全部已议条款
		} else {
			applyTerms = computeApplyTerms(co, body.AcceptedTerms)
		}

		if fullAccept {
			result, err := h.acceptSwapCounterOffer(ctx, co, applyTerms)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			if err := h.coRepo.Accept(ctx, coID, userID); err != nil {
				log.Error().Err(err).Msg("标记还价为 ACCEPTED 失败（成交已完成）")
			}
			h.coRepo.ExpireOthers(ctx, co.RefType, co.RefID, coID)

			if h.wsPush != nil {
				h.wsPush(co.OfferUserID, "counter_offer_accepted", gin.H{
					"id":     co.ID,
					"ref_id": co.RefID,
				})
			}

			c.JSON(http.StatusOK, gin.H{
				"message":       "还价已接受，成交完成！",
				"counter_offer": co,
				"swap_result":   result,
			})
			return
		}

		// 换盘也支持条款级部分接受：记录接受的条款，等待发起方确认
		raw, _ := json.Marshal(body.AcceptedTerms)
		if err := h.coRepo.PartialAccept(ctx, coID, raw); err != nil {
			log.Error().Err(err).Msg("换盘部分接受失败")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "部分接受失败"})
			return
		}
		if h.wsPush != nil {
			h.wsPush(co.OfferUserID, "counter_offer_partial_accepted", gin.H{
				"id":             co.ID,
				"ref_id":         co.RefID,
				"accepted_terms": body.AcceptedTerms,
			})
		}
		c.JSON(http.StatusOK, gin.H{
			"message":        "已部分接受，等待对方确认",
			"counter_offer":  co,
			"accepted_terms": body.AcceptedTerms,
		})
		return
	}

	// listing 类：判断是否部分接受
	offered := offeredTermKeys(co)
	fullAccept := len(body.AcceptedTerms) == 0 || covers(body.AcceptedTerms, offered)
	var applyTerms map[string]bool
	if len(body.AcceptedTerms) == 0 {
		applyTerms = computeApplyTerms(co, offered) // 全接受：采用全部已议条款
	} else {
		applyTerms = computeApplyTerms(co, body.AcceptedTerms)
	}

	if fullAccept {
		result, err := h.acceptListingCounterOffer(ctx, co, applyTerms)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := h.coRepo.MarkAccepted(ctx, coID); err != nil {
			log.Error().Err(err).Msg("标记还价为 ACCEPTED 失败（成交已完成）")
		}
		h.coRepo.ExpireOthers(ctx, co.RefType, co.RefID, coID)

		if h.wsPush != nil {
			h.wsPush(co.OfferUserID, "counter_offer_accepted", gin.H{
				"id":     co.ID,
				"ref_id": co.RefID,
			})
		}

		c.JSON(http.StatusOK, gin.H{
			"message":       "还价已接受，成交完成！",
			"counter_offer": co,
			"trade":         result,
		})
		return
	}

	// 部分接受：记录接受的条款，等待发起方确认
	raw, _ := json.Marshal(body.AcceptedTerms)
	if err := h.coRepo.PartialAccept(ctx, coID, raw); err != nil {
		log.Error().Err(err).Msg("部分接受失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "部分接受失败"})
		return
	}
	if h.wsPush != nil {
		h.wsPush(co.OfferUserID, "counter_offer_partial_accepted", gin.H{
			"id":             co.ID,
			"ref_id":         co.RefID,
			"accepted_terms": body.AcceptedTerms,
		})
	}
	c.JSON(http.StatusOK, gin.H{
		"message":        "已部分接受，等待对方确认",
		"counter_offer":  co,
		"accepted_terms": body.AcceptedTerms,
	})
}

// Respond 发起方对「部分接受」的二次确认
// POST /api/v1/counter-offers/:id/respond  body { action: "accept" | "reject" }
func (h *CounterOfferHandler) Respond(c *gin.Context) {
	userID := middleware.GetUserID(c)
	coID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的还价 ID"})
		return
	}
	ctx := c.Request.Context()
	co, err := h.coRepo.FindByID(ctx, coID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "还价不存在"})
		return
	}
	if co.OfferUserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "只有议价发起方才能确认部分接受"})
		return
	}
	if co.Status != repo.COStatusPartialAccepted {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该还价无需确认"})
		return
	}
	var body struct {
		Action string `json:"action"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Action == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 action"})
		return
	}

	// 黑名单检查（双向）
	if h.blacklistRepo != nil {
		dir, _ := h.blacklistRepo.IsBlocked(ctx, userID, co.ListingUserID)
		rev, _ := h.blacklistRepo.IsBlocked(ctx, co.ListingUserID, userID)
		if dir || rev {
			c.JSON(http.StatusForbidden, gin.H{"error": "已拉黑该用户，无法成交"})
			return
		}
	}

	if body.Action == "accept" {
		var accepted []string
		if len(co.AcceptedTerms) > 0 {
			_ = json.Unmarshal(co.AcceptedTerms, &accepted)
		}
		applyTerms := computeApplyTerms(co, accepted)
		if co.RefType == "swap" {
			result, err := h.acceptSwapCounterOffer(ctx, co, applyTerms)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			if err := h.coRepo.Accept(ctx, coID, userID); err != nil {
				log.Error().Err(err).Msg("标记还价为 ACCEPTED 失败（成交已完成）")
			}
			h.coRepo.ExpireOthers(ctx, co.RefType, co.RefID, coID)
			if h.wsPush != nil {
				h.wsPush(co.ListingUserID, "counter_offer_accepted", gin.H{
					"id":     co.ID,
					"ref_id": co.RefID,
				})
			}
			c.JSON(http.StatusOK, gin.H{
				"message":       "已确认，成交完成！",
				"counter_offer": co,
				"swap_result":   result,
			})
			return
		}
		result, err := h.acceptListingCounterOffer(ctx, co, applyTerms)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := h.coRepo.MarkAccepted(ctx, coID); err != nil {
			log.Error().Err(err).Msg("标记还价为 ACCEPTED 失败（成交已完成）")
		}
		h.coRepo.ExpireOthers(ctx, co.RefType, co.RefID, coID)
		if h.wsPush != nil {
			h.wsPush(co.ListingUserID, "counter_offer_accepted", gin.H{
				"id":     co.ID,
				"ref_id": co.RefID,
			})
		}
		c.JSON(http.StatusOK, gin.H{
			"message":       "已确认，成交完成！",
			"counter_offer": co,
			"trade":         result,
		})
		return
	}

	if body.Action == "reject" {
		if err := h.coRepo.RejectPartial(ctx, coID, userID, "对方拒绝部分接受"); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "拒绝对方的部分接受失败"})
			return
		}
		if h.wsPush != nil {
			h.wsPush(co.ListingUserID, "counter_offer_confirm_rejected", gin.H{
				"id":     co.ID,
				"ref_id": co.RefID,
			})
		}
		c.JSON(http.StatusOK, gin.H{"message": "已拒绝对方的部分接受"})
		return
	}

	c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 action，仅支持 accept / reject"})
}

// acceptListingCounterOffer 接受挂牌议价 → 为议价方创建对向挂牌单并成交
// applyTerms：本次成交要采用的议价条款键集合（price/quantity/delivery_period/.../specs）。
// 仅当某条款键在 applyTerms 中且议价方提供了对应报价时，才覆盖原盘条款；否则沿用原盘。
func (h *CounterOfferHandler) acceptListingCounterOffer(ctx context.Context, co *repo.CounterOffer, applyTerms map[string]bool) (gin.H, error) {
	target, err := h.listingRepo.FindByID(ctx, co.RefID)
	if err != nil {
		return nil, errors.New("挂牌不存在")
	}
	if target.Status != repo.ListingOpen && target.Status != repo.ListingPartial {
		return nil, errors.New("该挂牌已不可交易")
	}

	remaining := target.Quantity - target.Filled
	// 数量：仅当「quantity」被接受时采用议价数量，否则沿用剩余量
	qty := co.OfferQuantity
	if !applyTerms["quantity"] {
		qty = remaining
	}
	if qty > remaining {
		return nil, errors.New("议价数量超过剩余可成交量")
	}

	// 确定买卖方向：target 与议价方方向相反
	counterSide := "BUY"
	if target.Side == "BUY" {
		counterSide = "SELL"
	}

	// 价格：仅当「price」被接受时采用议价价，否则沿用原价
	price := co.OfferPrice
	if !applyTerms["price"] {
		price = target.Price
	}

	// 议价协商条款：仅对 applyTerms 中且还价提供了对应条款的项，使用还价条款覆盖原盘，否则沿用原盘
	deliveryPeriod := target.DeliveryPeriod
	if applyTerms["delivery_period"] && co.OfferDeliveryPeriod != nil {
		deliveryPeriod = co.OfferDeliveryPeriod
	}
	deliveryLocation := target.DeliveryLocation
	if applyTerms["delivery_location"] && co.OfferDeliveryLocation != nil {
		deliveryLocation = co.OfferDeliveryLocation
	}
	paymentMethod := target.PaymentMethod
	if applyTerms["payment_method"] && co.OfferPaymentMethod != nil {
		paymentMethod = co.OfferPaymentMethod
	}
	deliveryMethod := target.DeliveryMethod
	if applyTerms["delivery_method"] && co.OfferDeliveryMethod != nil {
		deliveryMethod = co.OfferDeliveryMethod
	}
	freeStorageEnabled := target.FreeStorageEnabled
	if applyTerms["free_storage"] && co.OfferFreeStorageEnabled != nil {
		freeStorageEnabled = *co.OfferFreeStorageEnabled
	}
	freeStorageDays := target.FreeStorageDays
	if applyTerms["free_storage"] && co.OfferFreeStorageDays != nil {
		freeStorageDays = co.OfferFreeStorageDays
	}
	var offerSpecs json.RawMessage
	if applyTerms["specs"] && co.OfferSpecs != nil && strings.TrimSpace(*co.OfferSpecs) != "" {
		// co.OfferSpecs 已是合法 JSON 文本，直接作为 RawMessage（勿再 json.Marshal，否则会被包成字符串）
		if raw := json.RawMessage(*co.OfferSpecs); json.Valid(raw) {
			offerSpecs = raw
		}
	}
	if offerSpecs == nil {
		offerSpecs = target.Specs
	}

	// 为议价方创建一条对向挂牌单（隐藏来源），用于满足 trades 外键约束
	// 直接设为 FILLED 状态，避免出现在公共挂牌列表中
	counterListing := &repo.Listing{
		UserID:           co.OfferUserID,
		ProductID:        target.ProductID,
		Side:             counterSide,
		Price:            price,
		Quantity:         qty,
		Filled:           qty,
		Status:            repo.ListingFilled,
		DeliveryPeriod:   deliveryPeriod,
		DeliveryLocation: deliveryLocation,
		PaymentMethod:    paymentMethod,
		DeliveryMethod:   deliveryMethod,
		Specs:            offerSpecs,
		FreeStorageEnabled: freeStorageEnabled,
		FreeStorageDays:  freeStorageDays,
		// negotiable_terms 为 NOT NULL 列；隐藏对向挂牌单直接置为不可议，避免 INSERT 报 NULL
		NegotiableTerms: json.RawMessage([]byte("[]")),
	}
	if err := h.listingRepo.Create(ctx, counterListing); err != nil {
		log.Error().Err(err).Msg("为议价方创建对向挂牌单失败")
		return nil, errors.New("成交准备失败")
	}

	// 确定买卖双方 userID 与 orderID
	var buyUID, sellUID uuid.UUID
	var buyOrderID, sellOrderID uuid.UUID
	// 确定买卖双边对应的挂牌（用于填充发盘条款明细）
	var buyListing, sellListing *repo.Listing
	if target.Side == "SELL" {
		// 挂牌是卖盘 → 挂牌方卖出，议价方买入
		buyUID = co.OfferUserID
		sellUID = target.UserID
		buyOrderID = counterListing.ID
		sellOrderID = target.ID
		buyListing = counterListing
		sellListing = target
	} else {
		// 挂牌是买盘 → 挂牌方买入，议价方卖出
		buyUID = target.UserID
		sellUID = co.OfferUserID
		buyOrderID = target.ID
		sellOrderID = counterListing.ID
		buyListing = target
		sellListing = counterListing
	}

	// 使用事务保证 成交记录 + 双方 filled 更新 + 状态 原子性
	tx, err := h.listingRepo.BeginTx(ctx)
	if err != nil {
		log.Error().Err(err).Msg("开启事务失败")
		return nil, errors.New("成交事务开启失败")
	}
	defer tx.Rollback(ctx)

	trade := &repo.Trade{
		ProductID:        target.ProductID,
		BuyOrderID:       buyOrderID,
		SellOrderID:      sellOrderID,
		BuyUserID:        buyUID,
		SellUserID:       sellUID,
		Price:            price,
		Quantity:         qty,
		DeliveryPeriod:   deliveryPeriod,
		DeliveryLocation: deliveryLocation,
		DeliveryMethod:   deliveryMethod,
		FreeStorageEnabled: &freeStorageEnabled,
		FreeStorageDays:  freeStorageDays,
	}
	// 填充双边发盘条款明细（序号、付款方式、交割方式、免仓期、规格）
	if buyListing != nil {
		trade.BuySerialNo = &buyListing.SerialNo
		trade.BuyPaymentMethod = buyListing.PaymentMethod
		trade.BuySpecs = normalizeSpecs(buyListing.Specs)
	}
	if sellListing != nil {
		trade.SellSerialNo = &sellListing.SerialNo
		trade.SellPaymentMethod = sellListing.PaymentMethod
		trade.SellSpecs = normalizeSpecs(sellListing.Specs)
	}
	trade.Source = "counter_offer"
	ag := co.OfferUserID
	trade.AggressorUserID = &ag
	if err := h.tradeRepo.CreateTx(ctx, tx, trade); err != nil {
		log.Error().Err(err).Msg("写入成交记录失败")
		return nil, errors.New("成交记录写入失败")
	}

	// 更新挂牌方已成交量（AddFilledTx 含状态检查：仅 OPEN/PARTIAL 可更新）
	if err := h.listingRepo.AddFilledTx(ctx, tx, target.ID, co.OfferQuantity); err != nil {
		if err == repo.ErrNotFound {
			return nil, errors.New("该挂牌已被撤盘或已成交，无法完成商谈成交")
		}
		log.Error().Err(err).Msg("更新挂牌已成交量失败")
		return nil, errors.New("挂牌更新失败")
	}

	// 更新议价方对向挂牌单为已完全成交
	if err := h.listingRepo.UpdateFilledTx(ctx, tx, counterListing.ID, co.OfferQuantity, repo.ListingFilled); err != nil {
		log.Error().Err(err).Msg("更新议价方挂牌状态失败")
		return nil, errors.New("议价方挂牌更新失败")
	}

	if err := tx.Commit(ctx); err != nil {
		log.Error().Err(err).Msg("提交成交事务失败")
		return nil, errors.New("成交提交失败")
	}

	// 从撮合引擎中更新挂牌方状态
	newFilled := target.Filled + co.OfferQuantity
	if newFilled >= target.Quantity {
		h.eng.CancelOrder(target.ProductID, target.ID.String())
	} else {
		h.eng.CancelOrder(target.ProductID, target.ID.String())
		updatedOrder := engine.OrderFromListing(
			target.ID.String(), target.ProductID, target.UserID.String(),
			engine.Side(target.Side), target.Price, target.Quantity, newFilled, target.MinQuantity, target.AllowPartial,
			engine.StatusPartial, target.CreatedAt,
		)
		h.eng.LoadOrder(updatedOrder)
	}

	// 资金结算
	if h.accountRepo != nil {
		if err := h.accountRepo.SettleTrade(ctx, buyUID, sellUID, buyOrderID, trade.ID, price, qty); err != nil {
			log.Error().Err(err).Msg("成交资金结算失败（异步补偿）")
		}
	}

	// WebSocket 广播成交
	if h.broadcast != nil {
		h.broadcast <- engine.Trade{
			ID:              trade.ID.String(),
			BuyOrder:        trade.BuyOrderID.String(),
			SellOrder:       trade.SellOrderID.String(),
			ProductID:       trade.ProductID,
			Price:           trade.Price,
			Quantity:        trade.Quantity,
			BuyUserID:       buyUID.String(),
			SellUserID:      sellUID.String(),
			Source:          "counter_offer",
			AggressorUserID: ag.String(),
		}
	}

	return gin.H{
		"id":         trade.ID,
		"product_id": trade.ProductID,
		"price":      trade.Price,
		"quantity":   trade.Quantity,
		"amount":     trade.Amount,
		"traded_at":  trade.TradedAt,
	}, nil
}

// acceptSwapCounterOffer 接受换盘还价。applyTerms 指定本次成交采用的议价条款键集合：
// 仅当条款键在 applyTerms 中且议价方提供了对应报价时，才覆盖换盘原腿条款，否则沿用换盘原条款。
func (h *CounterOfferHandler) acceptSwapCounterOffer(ctx context.Context, co *repo.CounterOffer, applyTerms map[string]bool) (gin.H, error) {
	mode := "both"
	if co.Mode != nil {
		mode = *co.Mode
	}

	var swapUserID uuid.UUID
	var swapStatus string
	var sellQty, buyQty, sellFilled, buyFilled float64
	var sellProductID, buyProductID string
	var sellPrice, buyPrice float64
	// 换盘完整交割条款（用于还价未指定时的回退，避免成交记录丢条款）
	var sellDP, sellDL, sellPM, sellDM *string
	var sellFSE *bool
	var sellFSD *int
	var sellSpecs json.RawMessage
	var buyDP, buyDL, buyPM, buyDM *string
	var buyFSE *bool
	var buyFSD *int
	var buySpecs json.RawMessage

	err := h.pool.QueryRow(ctx,
		`SELECT user_id, status,
		        sell_product_id, sell_price, sell_quantity, sell_filled,
		        buy_product_id, buy_price, buy_quantity, buy_filled,
		        sell_delivery_period, sell_delivery_location, sell_payment_method, sell_delivery_method,
		        sell_free_storage_enabled, sell_free_storage_days, sell_specs,
		        buy_delivery_period, buy_delivery_location, buy_payment_method, buy_delivery_method,
		        buy_free_storage_enabled, buy_free_storage_days, buy_specs
		 FROM swap_listings WHERE id = $1`, co.RefID,
	).Scan(&swapUserID, &swapStatus,
		&sellProductID, &sellPrice, &sellQty, &sellFilled,
		&buyProductID, &buyPrice, &buyQty, &buyFilled,
		&sellDP, &sellDL, &sellPM, &sellDM,
		&sellFSE, &sellFSD, &sellSpecs,
		&buyDP, &buyDL, &buyPM, &buyDM,
		&buyFSE, &buyFSD, &buySpecs)
	if err != nil {
		return nil, errors.New("换盘不存在")
	}
	if swapStatus != "OPEN" {
		return nil, errors.New("该换盘已不可交易")
	}

	// 数量：仅当「quantity」被接受时采用议价数量，否则沿用换盘对应腿剩余可成交量
	matchQty := co.OfferQuantity
	if !applyTerms["quantity"] {
		switch mode {
		case "sell":
			matchQty = sellQty - sellFilled
		case "buy":
			matchQty = buyQty - buyFilled
		case "both":
			remS := sellQty - sellFilled
			remB := buyQty - buyFilled
			if remS < remB {
				matchQty = remS
			} else {
				matchQty = remB
			}
		}
	}
	if matchQty <= 0 {
		return nil, errors.New("换盘对应腿已无可成交量")
	}

	var newSellFilled, newBuyFilled float64
	switch mode {
	case "sell":
		newSellFilled = sellFilled + matchQty
		newBuyFilled = buyFilled
	case "buy":
		newSellFilled = sellFilled
		newBuyFilled = buyFilled + matchQty
	case "both":
		newSellFilled = sellFilled + matchQty
		newBuyFilled = buyFilled + matchQty
	}

	// 更新换盘状态（含状态检查：仅 OPEN 状态的换盘才能更新，防止与撤盘竞态）
	tag, err := h.pool.Exec(ctx,
		`UPDATE swap_listings SET
		    sell_filled = $2, buy_filled = $3,
		    status = CASE WHEN $2 >= sell_quantity AND $3 >= buy_quantity THEN 'MATCHED' ELSE 'OPEN' END,
		    updated_at = NOW()
		 WHERE id=$1 AND status = 'OPEN'`, co.RefID, newSellFilled, newBuyFilled)
	if err != nil {
		return nil, errors.New("更新换盘状态失败")
	}
	if tag.RowsAffected() == 0 {
		return nil, errors.New("该换盘已被撤盘或已成交，无法完成商谈成交")
	}

	matchID := uuid.New()
	// 单边 = ACTIVE 锁定（不算成交）；双边摘盘 = FLASHED（计入成交价）
	lockStatus := "FLASHED"
	if mode == "sell" || mode == "buy" {
		lockStatus = "ACTIVE"
	}
	_, _ = h.pool.Exec(ctx,
		`INSERT INTO swap_matches (id, swap_a_id, swap_b_id, product_id, acceptor_id, matched_qty, matched_at, match_side, lock_status)
		 VALUES ($1, $2, NULL, $3, $4, $5, NOW(), $6, $7)`,
		matchID, co.RefID, sellProductID, co.OfferUserID, matchQty, mode, lockStatus)

	acceptorID := co.OfferUserID
	var tradeRecords []*repo.Trade

	// 解析议价相对某腿的最终价格/条款（用于真正成交时写 trade）
	resolveLeg := func(leg string) (productID string, price float64, buyerID, sellerID uuid.UUID, dp, dl, pm, dm *string, fse *bool, fsd *int, specsBuy, specsSell json.RawMessage) {
		var fbDP, fbDL, fbPM, fbDM *string
		var fbFSE *bool
		var fbFSD *int
		var fbSpecs json.RawMessage
		if leg == "buy" {
			productID = buyProductID
			price = buyPrice
			buyerID = swapUserID
			sellerID = acceptorID
			fbDP, fbDL, fbPM, fbDM = buyDP, buyDL, buyPM, buyDM
			fbFSE, fbFSD, fbSpecs = buyFSE, buyFSD, buySpecs
		} else {
			productID = sellProductID
			price = sellPrice
			buyerID = acceptorID
			sellerID = swapUserID
			fbDP, fbDL, fbPM, fbDM = sellDP, sellDL, sellPM, sellDM
			fbFSE, fbFSD, fbSpecs = sellFSE, sellFSD, sellSpecs
		}
		// 单腿议价：仅该腿可采用议价价
		if mode == leg && applyTerms["price"] {
			price = co.OfferPrice
		}
		dp, dl, dm = fbDP, fbDL, fbDM
		if mode == leg && applyTerms["delivery_period"] && co.OfferDeliveryPeriod != nil {
			dp = co.OfferDeliveryPeriod
		}
		if mode == leg && applyTerms["delivery_location"] && co.OfferDeliveryLocation != nil {
			dl = co.OfferDeliveryLocation
		}
		if mode == leg && applyTerms["delivery_method"] && co.OfferDeliveryMethod != nil {
			dm = co.OfferDeliveryMethod
		}
		fse, fsd = fbFSE, fbFSD
		if mode == leg && applyTerms["free_storage"] {
			if co.OfferFreeStorageEnabled != nil {
				fse = co.OfferFreeStorageEnabled
			}
			if co.OfferFreeStorageDays != nil {
				fsd = co.OfferFreeStorageDays
			}
		}
		pm = fbPM
		if mode == leg && applyTerms["payment_method"] && co.OfferPaymentMethod != nil {
			pm = co.OfferPaymentMethod
		}
		specsBuy, specsSell = fbSpecs, fbSpecs
		if mode == leg && applyTerms["specs"] && co.OfferSpecs != nil && strings.TrimSpace(*co.OfferSpecs) != "" {
			if raw := json.RawMessage(*co.OfferSpecs); json.Valid(raw) {
				if leg == "sell" {
					specsBuy = raw
				} else {
					specsSell = raw
				}
			}
		}
		return
	}

	buildTrade := func(leg string, buyOrderID uuid.UUID) *repo.Trade {
		productID, price, buyerID, sellerID, dp, dl, pm, dm, fse, fsd, specsBuy, specsSell := resolveLeg(leg)
		return &repo.Trade{
			ProductID:          productID,
			BuyOrderID:         buyOrderID,
			SellOrderID:        co.RefID,
			BuyUserID:          buyerID,
			SellUserID:         sellerID,
			Price:              price,
			Quantity:           matchQty,
			DeliveryPeriod:     dp,
			DeliveryLocation:   dl,
			BuyPaymentMethod:   pm,
			SellPaymentMethod:  pm,
			DeliveryMethod:     dm,
			FreeStorageEnabled: fse,
			FreeStorageDays:    fsd,
			BuySpecs:           specsBuy,
			SellSpecs:          specsSell,
			Source:             "swap",
			AggressorUserID:    &acceptorID,
		}
	}

	// 双边还盘（mode=both）：仅双方换盘，记私人成交，不计入行情
	if mode == "both" && h.tradeRepo != nil {
		sellTr := buildTrade("sell", matchID)
		buyTr := buildTrade("buy", matchID)
		sellTr.Source = repo.TradeSourceSwapPrivate
		buyTr.Source = repo.TradeSourceSwapPrivate
		tradeRecords = append(tradeRecords, sellTr, buyTr)
	}

	// 单边议价接受 = 单边锁定，默认不写 trade；仅当对向锁定配对（买卖合成）或撮合到挂牌（三方）时才计入成交价
	if (mode == "sell" || mode == "buy") && h.tradeRepo != nil {
		oppositeSide := "buy"
		if mode == "buy" {
			oppositeSide = "sell"
		}
		var oppLockID uuid.UUID
		var oppAcceptorID uuid.UUID
		var oppQty float64
		errOpp := h.pool.QueryRow(ctx,
			`SELECT id, acceptor_id, matched_qty FROM swap_matches
			 WHERE swap_a_id = $1 AND lock_status = 'ACTIVE' AND match_side = $2
			   AND id != $3 AND acceptor_id != $4
			 ORDER BY matched_at ASC LIMIT 1`,
			co.RefID, oppositeSide, matchID, acceptorID,
		).Scan(&oppLockID, &oppAcceptorID, &oppQty)

		if errOpp == nil && oppQty == matchQty {
			_, _ = h.pool.Exec(ctx, `UPDATE swap_matches SET lock_status = 'FLASHED' WHERE id IN ($1, $2)`, matchID, oppLockID)
			// 单边买 + 单边卖合成：两腿均计入成交价
			sellBuyer := acceptorID
			sellSeller := swapUserID
			buyBuyer := swapUserID
			buySeller := acceptorID
			if mode == "buy" {
				// 本次锁定买侧：当前 acceptor 是卖方；对向锁 sell 的 acceptor 是买方
				sellBuyer = oppAcceptorID
				buySeller = acceptorID
			} else {
				sellBuyer = acceptorID
				buySeller = oppAcceptorID
			}
			sProduct, sPrice, _, _, sDP, sDL, sPM, sDM, sFSE, sFSD, sBuySpecs, sSellSpecs := resolveLeg("sell")
			bProduct, bPrice, _, _, bDP, bDL, bPM, bDM, bFSE, bFSD, bBuySpecs, bSellSpecs := resolveLeg("buy")
			// 合成成交用换盘挂牌价（议价条款仅对本腿生效时可能已改）
			tradeRecords = append(tradeRecords,
				&repo.Trade{
					ProductID: sProduct, BuyOrderID: matchID, SellOrderID: co.RefID,
					BuyUserID: sellBuyer, SellUserID: sellSeller,
					Price: sPrice, Quantity: matchQty,
					DeliveryPeriod: sDP, DeliveryLocation: sDL, BuyPaymentMethod: sPM, SellPaymentMethod: sPM,
					DeliveryMethod: sDM, FreeStorageEnabled: sFSE, FreeStorageDays: sFSD,
					BuySpecs: sBuySpecs, SellSpecs: sSellSpecs, Source: "swap", AggressorUserID: &acceptorID,
				},
				&repo.Trade{
					ProductID: bProduct, BuyOrderID: matchID, SellOrderID: co.RefID,
					BuyUserID: buyBuyer, SellUserID: buySeller,
					Price: bPrice, Quantity: matchQty,
					DeliveryPeriod: bDP, DeliveryLocation: bDL, BuyPaymentMethod: bPM, SellPaymentMethod: bPM,
					DeliveryMethod: bDM, FreeStorageEnabled: bFSE, FreeStorageDays: bFSD,
					BuySpecs: bBuySpecs, SellSpecs: bSellSpecs, Source: "swap", AggressorUserID: &acceptorID,
				},
			)
			if h.wsPush != nil {
				h.wsPush(oppAcceptorID, "swap_lock_matched", map[string]interface{}{
					"swap_id":       co.RefID,
					"match_id":      oppLockID,
					"match_side":    oppositeSide,
					"matched_qty":   oppQty,
				})
			}
		} else if h.listingRepo != nil {
			// #697-6 三方：锁定腿与方向一致的普通挂牌撮合 → 该品种计入成交价
			var (
				legProductID        string
				legPrice            float64
				legDP, legDL, legPM, legDM *string
				legFSE              bool
				legFSD              *int
				legSpecs            json.RawMessage
				listingSide         string
			)
			if mode == "sell" {
				p, price, _, _, dp, dl, pm, dm, fse, fsd, specsBuy, _ := resolveLeg("sell")
				legProductID, legPrice = p, price
				legDP, legDL, legPM, legDM = dp, dl, pm, dm
				if fse != nil {
					legFSE = *fse
				}
				legFSD, legSpecs = fsd, specsBuy
				listingSide = "sell"
			} else {
				p, price, _, _, dp, dl, pm, dm, fse, fsd, _, specsSell := resolveLeg("buy")
				legProductID, legPrice = p, price
				legDP, legDL, legPM, legDM = dp, dl, pm, dm
				if fse != nil {
					legFSE = *fse
				}
				legFSD, legSpecs = fsd, specsSell
				listingSide = "buy"
			}
			var matchListingID, matchUserID uuid.UUID
			var matchSerialNo int64
			var matchSpecs json.RawMessage
			errList := h.pool.QueryRow(ctx,
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
				legProductID, listingSide, legPrice, matchQty, acceptorID,
				legDP, legDL, legPM, legDM, legFSE, legFSD,
			).Scan(&matchListingID, &matchUserID, &matchSerialNo, &matchSpecs)
			if errList == nil {
				_, _ = h.pool.Exec(ctx, `UPDATE swap_matches SET lock_status = 'FLASHED' WHERE id = $1`, matchID)
				_ = h.listingRepo.AddFilled(ctx, matchListingID, matchQty)
				var buyerID, sellerID uuid.UUID
				var buySpecs, sellSpecs json.RawMessage
				if mode == "sell" {
					buyerID, sellerID = acceptorID, matchUserID
					buySpecs, sellSpecs = legSpecs, matchSpecs
				} else {
					buyerID, sellerID = matchUserID, acceptorID
					buySpecs, sellSpecs = matchSpecs, legSpecs
				}
				tradeRecords = append(tradeRecords, &repo.Trade{
					ProductID:          legProductID,
					BuyOrderID:         matchListingID,
					SellOrderID:        co.RefID,
					BuyUserID:          buyerID,
					SellUserID:         sellerID,
					Price:              legPrice,
					Quantity:           matchQty,
					DeliveryPeriod:     legDP,
					DeliveryLocation:   legDL,
					BuyPaymentMethod:   legPM,
					SellPaymentMethod:  legPM,
					DeliveryMethod:     legDM,
					FreeStorageEnabled: &legFSE,
					FreeStorageDays:    legFSD,
					BuySpecs:           buySpecs,
					SellSpecs:          sellSpecs,
					Source:             "swap",
					AggressorUserID:    &acceptorID,
				})
			}
		}
	}

	var tradeResult *repo.Trade
	for _, tr := range tradeRecords {
		if err := h.tradeRepo.Create(ctx, tr); err != nil {
			log.Error().Err(err).Msg("写入换盘成交记录失败")
			continue
		}
		if tradeResult == nil {
			tradeResult = tr
		}
		// 双方换盘不推送行情 WS
		if h.broadcast != nil && tr.Source != repo.TradeSourceSwapPrivate {
			h.broadcast <- engine.Trade{
				ID:         tr.ID.String(),
				BuyOrder:   tr.BuyOrderID.String(),
				SellOrder:  tr.SellOrderID.String(),
				ProductID:  tr.ProductID,
				Price:      tr.Price,
				Quantity:   tr.Quantity,
				Source:     tr.Source,
				BuyUserID:  tr.BuyUserID.String(),
				SellUserID: tr.SellUserID.String(),
			}
		}
	}

	isLock := (mode == "sell" || mode == "buy") && len(tradeRecords) == 0
	marketPrice := false
	for _, tr := range tradeRecords {
		if tr.Source != repo.TradeSourceSwapPrivate {
			marketPrice = true
			break
		}
	}
	return gin.H{
		"match_id":     matchID,
		"match_side":   mode,
		"sell_filled":  newSellFilled,
		"buy_filled":   newBuyFilled,
		"trade":        tradeResult,
		"is_lock":      isLock,
		"market_price": marketPrice,
	}, nil
}

// ========== 拒绝还价 ==========

type RejectCounterOfferRequest struct {
	Reason string `json:"rejected_reason"`
}

// Reject 拒绝还价
// POST /api/v1/counter-offers/:id/reject
func (h *CounterOfferHandler) Reject(c *gin.Context) {
	userID := middleware.GetUserID(c)
	coID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的还价 ID"})
		return
	}

	var req RejectCounterOfferRequest
	_ = c.ShouldBindJSON(&req)

	ctx := c.Request.Context()

	co, err := h.coRepo.FindByID(ctx, coID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "还价不存在"})
		return
	}
	if co.ListingUserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "只有挂牌方才能拒绝还价"})
		return
	}
	if co.Status != repo.COStatusPENDING {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该还价已不可拒绝"})
		return
	}

	var reason *string
	if req.Reason != "" {
		reason = &req.Reason
	}

	if err := h.coRepo.Reject(ctx, coID, userID, reason); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "拒绝还价失败"})
		return
	}

	if h.wsPush != nil {
		h.wsPush(co.OfferUserID, "counter_offer_rejected", gin.H{
			"id":              co.ID,
			"ref_id":          co.RefID,
			"rejected_reason": req.Reason,
		})
	}

	c.JSON(http.StatusOK, gin.H{"message": "还价已拒绝"})
}

// ========== 更新商谈条款 ==========

// UpdateCounterOfferRequest 更新商谈请求体
type UpdateCounterOfferRequest struct {
	OfferPrice    float64 `json:"offer_price" binding:"required,gt=0"`
	OfferQuantity float64 `json:"offer_quantity" binding:"required,gt=0"`
	// 可协商的其他条款（可选；不传则沿用原盘条款）
	OfferDeliveryPeriod     *string `json:"offer_delivery_period"`
	OfferDeliveryLocation   *string `json:"offer_delivery_location"`
	OfferPaymentMethod      *string `json:"offer_payment_method"`
	OfferDeliveryMethod     *string `json:"offer_delivery_method"`
	OfferFreeStorageEnabled *bool   `json:"offer_free_storage_enabled"`
	OfferFreeStorageDays    *int    `json:"offer_free_storage_days"`
	OfferSpecs              *string `json:"offer_specs"`
}

// Update 议价发起方更新自己的 PENDING 商谈条款（不新建，只修改原商谈）
// PATCH /api/v1/counter-offers/:id
func (h *CounterOfferHandler) Update(c *gin.Context) {
	userID := middleware.GetUserID(c)
	coID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的议价 ID"})
		return
	}

	var req UpdateCounterOfferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()

	// 查找商谈记录
	co, err := h.coRepo.FindByID(ctx, coID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "商谈不存在"})
		return
	}

	// 权限校验：只有发起方才能修改
	if co.OfferUserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "只有商谈发起方才能修改"})
		return
	}

	// 状态校验：只有 PENDING 状态才能修改
	if co.Status != repo.COStatusPENDING {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该商谈已不可修改"})
		return
	}

	// specs 双编码守卫：如果 offer_specs 是合法 JSON 文本，直接存为 RawMessage
	offerSpecs := req.OfferSpecs
	if offerSpecs != nil && *offerSpecs != "" {
		if !json.Valid([]byte(*offerSpecs)) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "offer_specs 不是合法的 JSON 文本"})
			return
		}
	}

	// 更新商谈条款
	updatedCO, err := h.coRepo.Update(ctx, coID, userID,
		req.OfferPrice, req.OfferQuantity,
		req.OfferDeliveryPeriod, req.OfferDeliveryLocation, req.OfferPaymentMethod,
		req.OfferDeliveryMethod, req.OfferFreeStorageEnabled, req.OfferFreeStorageDays, offerSpecs,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新商谈失败"})
		return
	}

	// WebSocket 通知挂牌方：对方已更新商谈条款
	if h.wsPush != nil {
		h.wsPush(co.ListingUserID, "counter_offer_updated", gin.H{
			"id":          updatedCO.ID,
			"ref_type":    updatedCO.RefType,
			"ref_id":      updatedCO.RefID,
			"offer_price": updatedCO.OfferPrice,
			"offer_quantity": updatedCO.OfferQuantity,
			"offer_delivery_period":     updatedCO.OfferDeliveryPeriod,
			"offer_delivery_location":   updatedCO.OfferDeliveryLocation,
			"offer_payment_method":      updatedCO.OfferPaymentMethod,
			"offer_delivery_method":     updatedCO.OfferDeliveryMethod,
			"offer_free_storage_enabled": updatedCO.OfferFreeStorageEnabled,
			"offer_free_storage_days":    updatedCO.OfferFreeStorageDays,
			"offer_specs":               updatedCO.OfferSpecs,
			"updated_at":                updatedCO.UpdatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": updatedCO})
}

// ========== 撤销议价 ==========

// Cancel 议价方主动撤销自己的议价
// POST /api/v1/counter-offers/:id/cancel
func (h *CounterOfferHandler) Cancel(c *gin.Context) {
	userID := middleware.GetUserID(c)
	coID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的议价 ID"})
		return
	}

	ctx := c.Request.Context()

	co, err := h.coRepo.FindByID(ctx, coID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "议价不存在"})
		return
	}
	if co.OfferUserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "只有议价发起方才能撤销"})
		return
	}
	if co.Status != repo.COStatusPENDING {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该议价已不可撤销"})
		return
	}

	if err := h.coRepo.CancelByOfferUser(ctx, coID, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "撤销议价失败"})
		return
	}

	// WebSocket 通知挂牌方：对方已撤销议价
	if h.wsPush != nil {
		h.wsPush(co.ListingUserID, "counter_offer_cancelled", gin.H{
			"id":     co.ID,
			"ref_id": co.RefID,
		})
	}

	c.JSON(http.StatusOK, gin.H{"message": "议价已撤销"})
}

// ========== 定时过期 ==========

// ExpirePending 将当天之前未回复的 PENDING 议价标记为 EXPIRED
func (h *CounterOfferHandler) ExpirePending() {
	ctx := context.Background()
	count, err := h.coRepo.ExpirePending(ctx)
	if err != nil {
		log.Error().Err(err).Msg("定时过期议价任务失败")
		return
	}
	log.Info().Int64("expired_count", count).Msg("定时过期议价任务完成")
}

// oppositeSide 返回相反方向（BUY<->SELL）
func oppositeSide(s string) string {
	switch s {
	case "BUY":
		return "SELL"
	case "SELL":
		return "BUY"
	default:
		return ""
	}
}

// offererDisadvantageWarn 议价合理性检测：议价应有利于议价者，若反而对议价者不利则提示
//   - 我方作为卖方（接买盘，offererSide=SELL）：报价低于对方买价对卖方不利
//   - 我方作为买方（接卖盘，offererSide=BUY）：报价高于对方卖价对买方不利
//
// 合理议价（如对方买5300、我卖5350）是卖方争取更高价，不触发提示；只有卖低于买（吃亏）才提示。
func offererDisadvantageWarn(offerPrice float64, offererSide string, refPrice float64) string {
	if refPrice <= 0 || offererSide == "" {
		return ""
	}
	switch offererSide {
	case "SELL":
		if offerPrice < refPrice {
			return fmt.Sprintf("您作为卖方报出的价格（%.1f）低于对方买价（%.1f），低于买价对您不利，请确认是否合理", offerPrice, refPrice)
		}
	case "BUY":
		if offerPrice > refPrice {
			return fmt.Sprintf("您作为买方报出的价格（%.1f）高于对方卖价（%.1f），高于卖价对您不利，请确认是否合理", offerPrice, refPrice)
		}
	}
	return ""
}
