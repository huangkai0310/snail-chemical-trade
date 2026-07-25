package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
)

// AdminHolidayHandler 节假日管理 handler
type AdminHolidayHandler struct {
	holidayRepo *repo.HolidayRepo
}

// NewAdminHolidayHandler 创建节假日管理 handler
func NewAdminHolidayHandler(holidayRepo *repo.HolidayRepo) *AdminHolidayHandler {
	return &AdminHolidayHandler{holidayRepo: holidayRepo}
}

// List 列出节假日
// GET /api/v1/admin/holidays?year=2026
func (h *AdminHolidayHandler) List(c *gin.Context) {
	if yearStr := c.Query("year"); yearStr != "" {
		year, err := strconv.Atoi(yearStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的年份"})
			return
		}
		items, err := h.holidayRepo.ListByYear(c.Request.Context(), year)
		if err != nil {
			log.Error().Err(err).Msg("admin holiday list by year failed")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": items})
		return
	}

	items, err := h.holidayRepo.List(c.Request.Context())
	if err != nil {
		log.Error().Err(err).Msg("admin holiday list failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// Create 创建/更新节假日
// POST /api/v1/admin/holidays
func (h *AdminHolidayHandler) Create(c *gin.Context) {
	var req struct {
		Date      string `json:"date" binding:"required"` // YYYY-MM-DD
		IsHoliday bool   `json:"is_holiday"`
		Name      string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	date, err := time.Parse("2006-01-02", req.Date)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "日期格式错误，请使用 YYYY-MM-DD"})
		return
	}

	item, err := h.holidayRepo.Create(c.Request.Context(), date, req.IsHoliday, req.Name)
	if err != nil {
		log.Error().Err(err).Msg("admin holiday create failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": item})
}

// Update 更新节假日
// PUT /api/v1/admin/holidays/:id
func (h *AdminHolidayHandler) Update(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	var req struct {
		Date      string `json:"date" binding:"required"`
		IsHoliday bool   `json:"is_holiday"`
		Name      string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	date, err := time.Parse("2006-01-02", req.Date)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "日期格式错误，请使用 YYYY-MM-DD"})
		return
	}

	if err := h.holidayRepo.Update(c.Request.Context(), id, date, req.IsHoliday, req.Name); err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "节假日不存在"})
			return
		}
		log.Error().Err(err).Msg("admin holiday update failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "更新成功"})
}

// Delete 删除节假日
// DELETE /api/v1/admin/holidays/:id
func (h *AdminHolidayHandler) Delete(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	if err := h.holidayRepo.Delete(c.Request.Context(), id); err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "节假日不存在"})
			return
		}
		log.Error().Err(err).Msg("admin holiday delete failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// BatchUpsert 批量导入节假日（用于年度更新）
// POST /api/v1/admin/holidays/batch
func (h *AdminHolidayHandler) BatchUpsert(c *gin.Context) {
	var req struct {
		Items []struct {
			Date      string `json:"date" binding:"required"`
			IsHoliday bool   `json:"is_holiday"`
			Name      string `json:"name"`
		} `json:"items" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	holidays := make([]repo.Holiday, 0, len(req.Items))
	for _, item := range req.Items {
		date, err := time.Parse("2006-01-02", item.Date)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "日期格式错误: " + item.Date + "，请使用 YYYY-MM-DD"})
			return
		}
		holidays = append(holidays, repo.Holiday{
			Date:      date,
			IsHoliday: item.IsHoliday,
			Name:      item.Name,
		})
	}

	count, err := h.holidayRepo.BatchUpsert(c.Request.Context(), holidays)
	if err != nil {
		log.Error().Err(err).Msg("admin holiday batch upsert failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "批量导入失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "导入成功",
		"count":   count,
	})
}

// DeleteByYear 删除某年全部节假日
// DELETE /api/v1/admin/holidays/year/:year
func (h *AdminHolidayHandler) DeleteByYear(c *gin.Context) {
	year, err := strconv.Atoi(c.Param("year"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的年份"})
		return
	}

	count, err := h.holidayRepo.DeleteByYear(c.Request.Context(), year)
	if err != nil {
		log.Error().Err(err).Msg("admin holiday delete by year failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "删除成功",
		"count":   count,
	})
}
