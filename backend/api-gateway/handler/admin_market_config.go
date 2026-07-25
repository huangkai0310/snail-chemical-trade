package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
)

// AdminMarketConfigHandler 市场配置管理 handler
type AdminMarketConfigHandler struct {
	configRepo      *repo.MarketConfigRepo
	marketBroadcast chan<- MarketStatusEvent
}

// MarketStatusEvent 开闭市变更广播
type MarketStatusEvent struct {
	MarketOpen bool   `json:"market_open"`
	Reason     string `json:"reason"`
}

// NewAdminMarketConfigHandler 创建市场配置管理 handler
func NewAdminMarketConfigHandler(configRepo *repo.MarketConfigRepo) *AdminMarketConfigHandler {
	return &AdminMarketConfigHandler{configRepo: configRepo}
}

// SetMarketBroadcast 注入开闭市广播通道
func (h *AdminMarketConfigHandler) SetMarketBroadcast(ch chan<- MarketStatusEvent) {
	h.marketBroadcast = ch
}

// List 列出全部配置项
// GET /api/v1/admin/market-config
func (h *AdminMarketConfigHandler) List(c *gin.Context) {
	items, err := h.configRepo.List(c.Request.Context())
	if err != nil {
		log.Error().Err(err).Msg("admin market config list failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// Get 获取单个配置项
// GET /api/v1/admin/market-config/:key
func (h *AdminMarketConfigHandler) Get(c *gin.Context) {
	key := c.Param("key")
	value, err := h.configRepo.Get(c.Request.Context(), key)
	if err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "配置项不存在"})
			return
		}
		log.Error().Err(err).Msg("admin market config get failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"key": key, "value": value})
}

// Set 设置配置项
// PUT /api/v1/admin/market-config/:key
func (h *AdminMarketConfigHandler) Set(c *gin.Context) {
	key := c.Param("key")

	var req struct {
		Value       string `json:"value" binding:"required"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.configRepo.Set(c.Request.Context(), key, req.Value, req.Description); err != nil {
		log.Error().Err(err).Msg("admin market config set failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "设置失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "设置成功"})
}

// Delete 删除配置项
// DELETE /api/v1/admin/market-config/:key
func (h *AdminMarketConfigHandler) Delete(c *gin.Context) {
	key := c.Param("key")

	if err := h.configRepo.Delete(c.Request.Context(), key); err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "配置项不存在"})
			return
		}
		log.Error().Err(err).Msg("admin market config delete failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// GetMarketStatus 获取市场开闭状态
// GET /api/v1/admin/market-status
func (h *AdminMarketConfigHandler) GetMarketStatus(c *gin.Context) {
	open, err := h.configRepo.IsMarketOpen(c.Request.Context())
	if err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			// 配置不存在，默认开市
			c.JSON(http.StatusOK, gin.H{"market_open": true, "reason": ""})
			return
		}
		log.Error().Err(err).Msg("admin market status get failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}

	reason, _ := h.configRepo.Get(c.Request.Context(), "market_close_reason")
	c.JSON(http.StatusOK, gin.H{
		"market_open": open,
		"reason":      reason,
	})
}

// SetMarketStatus 设置市场开闭状态
// PUT /api/v1/admin/market-status
func (h *AdminMarketConfigHandler) SetMarketStatus(c *gin.Context) {
	var req struct {
		Open   bool   `json:"open"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.configRepo.SetMarketOpen(c.Request.Context(), req.Open, req.Reason); err != nil {
		log.Error().Err(err).Msg("admin market status set failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "设置失败"})
		return
	}

	status := "开市"
	if !req.Open {
		status = "闭市"
	}

	// 推送到交易大厅（局部刷新开闭市状态）
	if h.marketBroadcast != nil {
		select {
		case h.marketBroadcast <- MarketStatusEvent{MarketOpen: req.Open, Reason: req.Reason}:
		default:
			log.Warn().Msg("marketBroadcast 通道已满，跳过本次推送")
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message":     "市场状态已更新",
		"market_open": req.Open,
		"status":      status,
		"reason":      req.Reason,
	})
}
