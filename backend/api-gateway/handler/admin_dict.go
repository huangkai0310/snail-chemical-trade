package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
)

// AdminDictHandler 字典表管理 handler（6张字典表统一处理）
type AdminDictHandler struct {
	// 6张字典表的 repo 实例
	periodRepo    *repo.DictRepo
	locationRepo  *repo.DictRepo
	specRepo      *repo.DictRepo
	paymentRepo   *repo.DictRepo
	methodRepo    *repo.DictRepo
	freeStorageRepo *repo.DictRepo
}

// NewAdminDictHandler 创建字典表管理 handler
func NewAdminDictHandler(pool *pgxpool.Pool) *AdminDictHandler {
	return &AdminDictHandler{
		periodRepo:    repo.NewDeliveryPeriodRepo(pool),
		locationRepo:  repo.NewDeliveryLocationRepo(pool),
		specRepo:      repo.NewProductSpecRepo(pool),
		paymentRepo:   repo.NewPaymentMethodRepo(pool),
		methodRepo:    repo.NewDeliveryMethodRepo(pool),
		freeStorageRepo: repo.NewFreeStorageDefaultRepo(pool),
	}
}

// dictRepos 返回 dictType → DictRepo 的映射
func (h *AdminDictHandler) dictRepos() map[string]*repo.DictRepo {
	return map[string]*repo.DictRepo{
		"delivery-periods":   h.periodRepo,
		"delivery-locations": h.locationRepo,
		"product-specs":      h.specRepo,
		"payment-methods":    h.paymentRepo,
		"delivery-methods":   h.methodRepo,
		"free-storage":       h.freeStorageRepo,
	}
}

// getRepo 根据 dictType 路径参数获取对应的 DictRepo
func (h *AdminDictHandler) getRepo(c *gin.Context) (*repo.DictRepo, bool) {
	dictType := c.Param("dictType")
	repos := h.dictRepos()
	r, ok := repos[dictType]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的字典类型: " + dictType})
		return nil, false
	}
	return r, true
}

// List 列出字典项
// GET /api/v1/admin/dict/:dictType
func (h *AdminDictHandler) List(c *gin.Context) {
	r, ok := h.getRepo(c)
	if !ok {
		return
	}

	// 可选参数 active=true 只查启用的
	activeOnly := c.Query("active") == "true"

	var items interface{}
	var err error
	if activeOnly {
		items, err = r.ListActive(c.Request.Context())
	} else {
		items, err = r.List(c.Request.Context())
	}
	if err != nil {
		log.Error().Err(err).Str("table", r.TableName()).Msg("admin dict list failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": items})
}

// Create 创建字典项
// POST /api/v1/admin/dict/:dictType
func (h *AdminDictHandler) Create(c *gin.Context) {
	r, ok := h.getRepo(c)
	if !ok {
		return
	}

	if r.IsFreeStorage() {
		// 免仓表需要额外字段
		var req struct {
			Name        string  `json:"name" binding:"required"`
			Days        int     `json:"days" binding:"required,min=1"`
			MinQuantity float64 `json:"min_quantity"`
			SortOrder   int     `json:"sort_order"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		item, err := r.CreateFreeStorage(c.Request.Context(), req.Name, req.Days, req.MinQuantity, req.SortOrder)
		if err != nil {
			if errors.Is(err, repo.ErrDuplicate) {
				c.JSON(http.StatusConflict, gin.H{"error": "名称已存在"})
				return
			}
			log.Error().Err(err).Msg("admin dict create free storage failed")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": item})
		return
	}

	// 通用字典表
	var req struct {
		Name      string `json:"name" binding:"required"`
		SortOrder int    `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	item, err := r.Create(c.Request.Context(), req.Name, req.SortOrder)
	if err != nil {
		if errors.Is(err, repo.ErrDuplicate) {
			c.JSON(http.StatusConflict, gin.H{"error": "名称已存在"})
			return
		}
		log.Error().Err(err).Msg("admin dict create failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": item})
}

// Update 更新字典项
// PUT /api/v1/admin/dict/:dictType/:id
func (h *AdminDictHandler) Update(c *gin.Context) {
	r, ok := h.getRepo(c)
	if !ok {
		return
	}

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	if r.IsFreeStorage() {
		var req struct {
			Name        string  `json:"name" binding:"required"`
			Days        int     `json:"days" binding:"required,min=1"`
			MinQuantity float64 `json:"min_quantity"`
			SortOrder   int     `json:"sort_order"`
			Active      bool    `json:"active"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := r.UpdateFreeStorage(c.Request.Context(), id, req.Name, req.Days, req.MinQuantity, req.SortOrder, req.Active); err != nil {
			if errors.Is(err, repo.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
				return
			}
			log.Error().Err(err).Msg("admin dict update free storage failed")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "更新成功"})
		return
	}

	var req struct {
		Name      string `json:"name" binding:"required"`
		SortOrder int    `json:"sort_order"`
		Active    bool   `json:"active"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := r.Update(c.Request.Context(), id, req.Name, req.SortOrder, req.Active); err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
			return
		}
		log.Error().Err(err).Msg("admin dict update failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "更新成功"})
}

// Delete 删除字典项
// DELETE /api/v1/admin/dict/:dictType/:id
func (h *AdminDictHandler) Delete(c *gin.Context) {
	r, ok := h.getRepo(c)
	if !ok {
		return
	}

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	if err := r.Delete(c.Request.Context(), id); err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
			return
		}
		log.Error().Err(err).Msg("admin dict delete failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}
