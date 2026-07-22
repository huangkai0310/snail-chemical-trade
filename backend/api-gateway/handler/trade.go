package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/middleware"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
)

type TradeHandler struct {
	tradeRepo *repo.TradeRepo
}

func NewTradeHandler(tradeRepo *repo.TradeRepo) *TradeHandler {
	return &TradeHandler{tradeRepo: tradeRepo}
}

// List 最近成交记录
func (h *TradeHandler) List(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	productID := c.Query("product_id")
	deliveryPeriod := c.Query("delivery_period")

	var (
		trades []repo.Trade
		err    error
	)
	if productID != "" {
		trades, err = h.tradeRepo.ListByProduct(c.Request.Context(), productID, limit, deliveryPeriod)
	} else {
		trades, err = h.tradeRepo.ListRecent(c.Request.Context(), limit)
	}
	if err != nil {
		log.Error().Err(err).Msg("查询成交记录失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	if trades == nil {
		trades = []repo.Trade{}
	}

	c.JSON(http.StatusOK, gin.H{"data": trades})
}

// MyTrades 查询与当前用户相关的成交
func (h *TradeHandler) MyTrades(c *gin.Context) {
	userID := middleware.GetUserID(c)
	trades, err := h.tradeRepo.ListByUser(c.Request.Context(), userID, 50)
	if err != nil {
		log.Error().Err(err).Msg("查询我的成交失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	if trades == nil {
		trades = []repo.Trade{}
	}
	c.JSON(http.StatusOK, gin.H{"data": trades})
}

// PriceHistory 价格走势图数据
// GET /api/v1/trades/price-history?product_id=benzene&interval=1h&limit=60&delivery_period=2606下
func (h *TradeHandler) PriceHistory(c *gin.Context) {
	productID := c.Query("product_id")
	if productID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请指定 product_id"})
		return
	}

	// interval 映射前端参数到后端参数
	intervalMap := map[string]string{
		"time": "1 minute", "1m": "1 minute", "5m": "5 minutes", "15m": "15 minutes", "30m": "30 minutes",
		"1h": "1 hour", "2h": "2 hours", "4h": "4 hours",
		"1d": "1 day", "1w": "1 week", "1M": "1 month", "1q": "3 months", "1y": "1 year",
	}
	intervalKey := c.DefaultQuery("interval", "1h")
	interval, ok := intervalMap[intervalKey]
	if !ok {
		interval = "1 hour"
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "60"))
	deliveryPeriod := c.Query("delivery_period")

	candles, err := h.tradeRepo.GetPriceHistory(c.Request.Context(), productID, interval, limit, deliveryPeriod)
	if err != nil {
		log.Error().Err(err).Msg("查询价格走势失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	if candles == nil {
		candles = []repo.PriceCandle{}
	}
	c.JSON(http.StatusOK, gin.H{"data": candles})
}

// LatestPrice 最新价格及相对昨结涨跌幅
// 昨结 = 上一工作日（含国务院法定节假日 / 调休）行情成交量加权均价。
// GET /api/v1/trades/latest-price?product_id=benzene&delivery_period=2606下
func (h *TradeHandler) LatestPrice(c *gin.Context) {
	productID := c.Query("product_id")
	if productID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请指定 product_id"})
		return
	}

	deliveryPeriod := c.Query("delivery_period")

	latest, prevSettle, volumeToday, err := h.tradeRepo.GetLatestPrice(c.Request.Context(), productID, deliveryPeriod)
	if err != nil {
		log.Error().Err(err).Msg("查询最新价格失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}

	var change, changePct float64
	if prevSettle > 0 {
		change = latest - prevSettle
		changePct = change / prevSettle * 100
	}

	c.JSON(http.StatusOK, gin.H{
		"product_id":   productID,
		"latest":       latest,
		"prev_settle":  prevSettle,
		"prev_24h":     prevSettle, // 兼容旧字段：现为日历昨结，非滚动 24h
		"change_24h":   change,
		"change_pct":   changePct,
		"volume_today": volumeToday,
		"volume_24h":   volumeToday, // 兼容旧字段：现为今日自然日成交量
	})
}

