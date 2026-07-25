package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
)

// AdminProductHandler 品种管理 handler
type AdminProductHandler struct {
	productRepo *repo.ProductRepo
}

// NewAdminProductHandler 创建品种管理 handler
func NewAdminProductHandler(productRepo *repo.ProductRepo) *AdminProductHandler {
	return &AdminProductHandler{productRepo: productRepo}
}

// List 列出全部品种（含禁用）
// GET /api/v1/admin/products
func (h *AdminProductHandler) List(c *gin.Context) {
	products, err := h.productRepo.ListAll(c.Request.Context())
	if err != nil {
		log.Error().Err(err).Msg("admin product list failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": products})
}

// Create 创建品种
// POST /api/v1/admin/products
func (h *AdminProductHandler) Create(c *gin.Context) {
	var req struct {
		ID        string  `json:"id" binding:"required"`
		Name      string  `json:"name" binding:"required"`
		NameEn    *string `json:"name_en"`
		Unit      string  `json:"unit" binding:"required"`
		Category  *string `json:"category"`
		SortOrder int     `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	product, err := h.productRepo.Create(c.Request.Context(), req.ID, req.Name, req.NameEn, req.Unit, req.Category, req.SortOrder)
	if err != nil {
		log.Error().Err(err).Str("id", req.ID).Msg("admin product create failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": product})
}

// Update 更新品种
// PUT /api/v1/admin/products/:id
func (h *AdminProductHandler) Update(c *gin.Context) {
	id := c.Param("id")

	var req struct {
		Name      string  `json:"name" binding:"required"`
		NameEn    *string `json:"name_en"`
		Unit      string  `json:"unit" binding:"required"`
		Category  *string `json:"category"`
		SortOrder int     `json:"sort_order"`
		Active    bool    `json:"active"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.productRepo.Update(c.Request.Context(), id, req.Name, req.NameEn, req.Unit, req.Category, req.SortOrder, req.Active); err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "品种不存在"})
			return
		}
		log.Error().Err(err).Str("id", id).Msg("admin product update failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "更新成功"})
}

// Delete 删除品种
// DELETE /api/v1/admin/products/:id
func (h *AdminProductHandler) Delete(c *gin.Context) {
	id := c.Param("id")

	if err := h.productRepo.Delete(c.Request.Context(), id); err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "品种不存在"})
			return
		}
		log.Error().Err(err).Str("id", id).Msg("admin product delete failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}
