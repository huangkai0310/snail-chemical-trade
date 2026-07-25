package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
)

// AdminCronTaskHandler 定时任务管理 handler
type AdminCronTaskHandler struct {
	cronTaskRepo *repo.CronTaskRepo
}

// NewAdminCronTaskHandler 创建定时任务管理 handler
func NewAdminCronTaskHandler(cronTaskRepo *repo.CronTaskRepo) *AdminCronTaskHandler {
	return &AdminCronTaskHandler{cronTaskRepo: cronTaskRepo}
}

// List 列出全部定时任务
// GET /api/v1/admin/cron-tasks
func (h *AdminCronTaskHandler) List(c *gin.Context) {
	enabledOnly := c.Query("enabled") == "true"

	var items []repo.CronTask
	var err error
	if enabledOnly {
		items, err = h.cronTaskRepo.ListEnabled(c.Request.Context())
	} else {
		items, err = h.cronTaskRepo.List(c.Request.Context())
	}
	if err != nil {
		log.Error().Err(err).Msg("admin cron task list failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// Create 创建定时任务
// POST /api/v1/admin/cron-tasks
func (h *AdminCronTaskHandler) Create(c *gin.Context) {
	var req struct {
		Name            string  `json:"name" binding:"required"`
		Description     string  `json:"description"`
		TaskType        string  `json:"task_type" binding:"required"` // "interval" 或 "cron"
		IntervalSeconds *int    `json:"interval_seconds"`
		CronExpr        *string `json:"cron_expr"`
		Enabled         bool    `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 校验：interval 类型必须提供 interval_seconds，cron 类型必须提供 cron_expr
	if req.TaskType == "interval" && (req.IntervalSeconds == nil || *req.IntervalSeconds <= 0) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "interval 类型任务必须提供正整数 interval_seconds"})
		return
	}
	if req.TaskType == "cron" && (req.CronExpr == nil || *req.CronExpr == "") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cron 类型任务必须提供 cron_expr"})
		return
	}

	task, err := h.cronTaskRepo.Create(c.Request.Context(), req.Name, req.Description, req.TaskType, req.IntervalSeconds, req.CronExpr, req.Enabled)
	if err != nil {
		log.Error().Err(err).Str("name", req.Name).Msg("admin cron task create failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": task})
}

// Update 更新定时任务配置
// PUT /api/v1/admin/cron-tasks/:id
func (h *AdminCronTaskHandler) Update(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	var req struct {
		Name            string  `json:"name" binding:"required"`
		Description     string  `json:"description"`
		TaskType        string  `json:"task_type" binding:"required"`
		IntervalSeconds *int    `json:"interval_seconds"`
		CronExpr        *string `json:"cron_expr"`
		Enabled         bool    `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.TaskType == "interval" && (req.IntervalSeconds == nil || *req.IntervalSeconds <= 0) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "interval 类型任务必须提供正整数 interval_seconds"})
		return
	}
	if req.TaskType == "cron" && (req.CronExpr == nil || *req.CronExpr == "") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cron 类型任务必须提供 cron_expr"})
		return
	}

	if err := h.cronTaskRepo.Update(c.Request.Context(), id, req.Name, req.Description, req.TaskType, req.IntervalSeconds, req.CronExpr, req.Enabled); err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
			return
		}
		log.Error().Err(err).Msg("admin cron task update failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "更新成功"})
}

// Delete 删除定时任务
// DELETE /api/v1/admin/cron-tasks/:id
func (h *AdminCronTaskHandler) Delete(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	if err := h.cronTaskRepo.Delete(c.Request.Context(), id); err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
			return
		}
		log.Error().Err(err).Msg("admin cron task delete failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// Toggle 启用/禁用定时任务
// PUT /api/v1/admin/cron-tasks/:id/toggle
func (h *AdminCronTaskHandler) Toggle(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.cronTaskRepo.ToggleEnabled(c.Request.Context(), id, req.Enabled); err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
			return
		}
		log.Error().Err(err).Msg("admin cron task toggle failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "操作失败"})
		return
	}

	status := "已禁用"
	if req.Enabled {
		status = "已启用"
	}
	c.JSON(http.StatusOK, gin.H{
		"message": status,
		"enabled": req.Enabled,
	})
}
