package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
)

// IndicatorCacheHandler 指标缓存 API
type IndicatorCacheHandler struct {
	repo *repo.IndicatorCacheRepo
}

func NewIndicatorCacheHandler(repo *repo.IndicatorCacheRepo) *IndicatorCacheHandler {
	return &IndicatorCacheHandler{repo: repo}
}

// upsertRequest 写入/更新指标缓存请求体
type upsertRequest struct {
	ProductID      string          `json:"product_id" binding:"required"`
	DeliveryPeriod string          `json:"delivery_period"`
	Interval       string          `json:"interval"`
	Indicator      string          `json:"indicator" binding:"required"`
	Params         json.RawMessage `json:"params"`
	Value          json.RawMessage `json:"value" binding:"required"`
	ComputedAt     *time.Time      `json:"computed_at,omitempty"`
	DataThrough    *time.Time      `json:"data_through,omitempty"`
}

// Upsert 写入或更新指标缓存
// POST /api/v1/indicators
func (h *IndicatorCacheHandler) Upsert(c *gin.Context) {
	var req upsertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 默认值
	if req.DeliveryPeriod == "" {
		req.DeliveryPeriod = "现货"
	}
	if req.Interval == "" {
		req.Interval = "1d"
	}
	if len(req.Params) == 0 {
		req.Params = json.RawMessage([]byte("{}"))
	}

	ic := &repo.IndicatorCache{
		ProductID:       req.ProductID,
		DeliveryPeriod:  req.DeliveryPeriod,
		Interval:        req.Interval,
		Indicator:       req.Indicator,
		Params:          req.Params,
		Value:           req.Value,
	}
	if req.ComputedAt != nil {
		ic.ComputedAt = *req.ComputedAt
	}
	if req.DataThrough != nil {
		ic.DataThrough = *req.DataThrough
	}

	if err := h.repo.Upsert(c.Request.Context(), ic); err != nil {
		log.Error().Err(err).Msg("写入指标缓存失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "写入失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": ic})
}

// Get 查询单个指标缓存
// GET /api/v1/indicators?product_id=benzene&delivery_period=现货&interval=1d&indicator=ma&params={"period":30}
func (h *IndicatorCacheHandler) Get(c *gin.Context) {
	productID := c.Query("product_id")
	if productID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请指定 product_id"})
		return
	}
	deliveryPeriod := c.DefaultQuery("delivery_period", "现货")
	interval := c.DefaultQuery("interval", "1d")
	indicator := c.Query("indicator")
	if indicator == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请指定 indicator"})
		return
	}

	var params json.RawMessage
	paramsStr := c.Query("params")
	if paramsStr == "" {
		params = json.RawMessage([]byte("{}"))
	} else {
		if !json.Valid([]byte(paramsStr)) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "params 不是合法 JSON"})
			return
		}
		params = json.RawMessage(paramsStr)
	}

	ic, err := h.repo.Get(c.Request.Context(), productID, deliveryPeriod, interval, indicator, params)
	if err != nil {
		if err == repo.ErrNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "指标缓存不存在"})
			return
		}
		log.Error().Err(err).Msg("查询指标缓存失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": ic})
}

// List 查询某产品某交割期某周期下的所有指标缓存
// GET /api/v1/indicators/list?product_id=benzene&delivery_period=现货&interval=1d
func (h *IndicatorCacheHandler) List(c *gin.Context) {
	productID := c.Query("product_id")
	if productID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请指定 product_id"})
		return
	}
	deliveryPeriod := c.DefaultQuery("delivery_period", "现货")
	interval := c.DefaultQuery("interval", "1d")

	indicator := c.Query("indicator")
	var (
		items []repo.IndicatorCache
		err   error
	)
	if indicator != "" {
		items, err = h.repo.ListByIndicator(c.Request.Context(), productID, deliveryPeriod, interval, indicator)
	} else {
		items, err = h.repo.List(c.Request.Context(), productID, deliveryPeriod, interval)
	}
	if err != nil {
		log.Error().Err(err).Msg("查询指标缓存列表失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	if items == nil {
		items = []repo.IndicatorCache{}
	}

	c.JSON(http.StatusOK, gin.H{"data": items})
}

// Delete 删除指定指标缓存
// DELETE /api/v1/indicators?product_id=benzene&delivery_period=现货&interval=1d&indicator=ma&params={"period":30}
func (h *IndicatorCacheHandler) Delete(c *gin.Context) {
	productID := c.Query("product_id")
	if productID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请指定 product_id"})
		return
	}
	deliveryPeriod := c.DefaultQuery("delivery_period", "现货")
	interval := c.DefaultQuery("interval", "1d")
	indicator := c.Query("indicator")
	if indicator == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请指定 indicator"})
		return
	}

	var params json.RawMessage
	paramsStr := c.Query("params")
	if paramsStr == "" {
		params = json.RawMessage([]byte("{}"))
	} else {
		if !json.Valid([]byte(paramsStr)) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "params 不是合法 JSON"})
			return
		}
		params = json.RawMessage(paramsStr)
	}

	if err := h.repo.Delete(c.Request.Context(), productID, deliveryPeriod, interval, indicator, params); err != nil {
		if err == repo.ErrNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "指标缓存不存在"})
			return
		}
		log.Error().Err(err).Msg("删除指标缓存失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}
