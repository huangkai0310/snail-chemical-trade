package handler

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/middleware"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
	"github.com/huangkai0310/snail-chemical-trade/matching-engine"
)

type ListingHandler struct {
	listingRepo *repo.ListingRepo
	eng         *engine.Engine
	tradeRepo   *repo.TradeRepo
	broadcast   chan<- engine.Trade
}

func NewListingHandler(listingRepo *repo.ListingRepo, eng *engine.Engine, tradeRepo *repo.TradeRepo, broadcast chan<- engine.Trade) *ListingHandler {
	return &ListingHandler{listingRepo: listingRepo, eng: eng, tradeRepo: tradeRepo, broadcast: broadcast}
}

// CreateListingRequest 创建挂牌请求
type CreateListingRequest struct {
	ProductID        string          `json:"product_id" binding:"required"`
	Side             string          `json:"side" binding:"required,oneof=BUY SELL"`
	Price            float64         `json:"price" binding:"required,gt=0"`
	Quantity         float64         `json:"quantity" binding:"required,gt=0"`
	DeliveryPeriod   string          `json:"delivery_period"`
	DeliveryLocation string          `json:"delivery_location"`
	Specs            json.RawMessage `json:"specs"`
	Remark           string          `json:"remark"`
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

	// 1. 写入数据库
	var dp, dl, rm *string
	if req.DeliveryPeriod != "" {
		dp = &req.DeliveryPeriod
	}
	if req.DeliveryLocation != "" {
		dl = &req.DeliveryLocation
	}
	if req.Remark != "" {
		rm = &req.Remark
	}

	listing := &repo.Listing{
		UserID:           userID,
		ProductID:        req.ProductID,
		Side:             req.Side,
		Price:            req.Price,
		Quantity:         req.Quantity,
		DeliveryPeriod:   dp,
		DeliveryLocation: dl,
		Specs:            req.Specs,
		Remark:           rm,
	}
	if err := h.listingRepo.Create(ctx, listing); err != nil {
		log.Error().Err(err).Msg("创建挂牌失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建挂牌失败"})
		return
	}

	// 2. 送入撮合引擎
	order := engine.NewOrder(listing.ProductID, engine.Side(listing.Side), listing.Price, listing.Quantity, listing.ID.String())
	trades := h.eng.Execute(order)

	// 3. 处理成交
	var tradeResults []gin.H
	for _, t := range trades {
		// 解析买卖双方订单 ID
		buyOrderID, _ := uuid.Parse(t.BuyOrder)
		sellOrderID, _ := uuid.Parse(t.SellOrder)

		// 获取买卖双方用户 ID
		buyUID, err := h.listingRepo.GetUserID(ctx, buyOrderID)
		if err != nil {
			log.Error().Err(err).Str("order_id", t.BuyOrder).Msg("获取买方用户失败")
		}
		sellUID, err := h.listingRepo.GetUserID(ctx, sellOrderID)
		if err != nil {
			log.Error().Err(err).Str("order_id", t.SellOrder).Msg("获取卖方用户失败")
		}

		// 写入成交记录
		trade := &repo.Trade{
			ProductID:  t.ProductID,
			BuyOrderID:  buyOrderID,
			SellOrderID: sellOrderID,
			BuyUserID:   buyUID,
			SellUserID:  sellUID,
			Price:      t.Price,
			Quantity:   t.Quantity,
		}
		if err := h.tradeRepo.Create(ctx, trade); err != nil {
			log.Error().Err(err).Msg("保存成交失败")
		}

		// 更新双方挂牌的已成交量
		h.listingRepo.UpdateFilled(ctx, buyOrderID, 0, repo.ListingFilled)
		h.listingRepo.UpdateFilled(ctx, sellOrderID, 0, repo.ListingFilled)

		// 广播成交
		if h.broadcast != nil {
			h.broadcast <- t
		}

		tradeResults = append(tradeResults, gin.H{
			"id":       trade.ID,
			"price":    trade.Price,
			"quantity": trade.Quantity,
			"amount":   trade.Amount,
		})
	}

	// 4. 更新当前挂牌的状态
	listing.Filled = order.Filled
	listing.Status = repo.ListingStatus(order.Status)
	_ = h.listingRepo.UpdateFilled(ctx, listing.ID, order.Filled, listing.Status)

	c.JSON(http.StatusOK, gin.H{
		"listing": listing,
		"trades":  tradeResults,
	})
}

// List 列表查询
func (h *ListingHandler) List(c *gin.Context) {
	productID := c.Query("product_id")
	if productID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请指定 product_id"})
		return
	}

	listings, err := h.listingRepo.ListByProduct(c.Request.Context(), productID)
	if err != nil {
		log.Error().Err(err).Msg("查询挂牌列表失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}

	if listings == nil {
		listings = []repo.Listing{}
	}

	c.JSON(http.StatusOK, gin.H{"data": listings})
}

// Cancel 撤牌
func (h *ListingHandler) Cancel(c *gin.Context) {
	userID := middleware.GetUserID(c)
	id := c.Param("id")

	listingID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的挂牌 ID"})
		return
	}

	if err := h.listingRepo.Cancel(c.Request.Context(), listingID, userID); err != nil {
		if err == repo.ErrNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "挂牌不存在或无法撤销"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "撤销失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "撤销成功"})
}
