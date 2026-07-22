package handler

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/middleware"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
)

type BlacklistHandler struct {
	blacklistRepo *repo.BlacklistRepo
	userRepo      *repo.UserRepo
}

func NewBlacklistHandler(blacklistRepo *repo.BlacklistRepo, userRepo *repo.UserRepo) *BlacklistHandler {
	return &BlacklistHandler{
		blacklistRepo: blacklistRepo,
		userRepo:      userRepo,
	}
}

// AddBlacklistRequest 添加黑名单请求
// 兼容旧调用：传 blocked_user_id（UUID）
// 新调用：传 identifier（UUID / 公司名称 / 用户名，三选一）
// 拉黑后：双方互相看不到对方发盘，且无法成交（allow_view 已废弃，忽略）
type AddBlacklistRequest struct {
	BlockedUserID string `json:"blocked_user_id"`
	Identifier    string `json:"identifier"`
	AllowView     *bool  `json:"allow_view"` // 废弃，保留兼容
}

// List 查询当前用户的黑名单列表
// GET /api/v1/blacklist
func (h *BlacklistHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)

	entries, err := h.blacklistRepo.List(c.Request.Context(), userID)
	if err != nil {
		log.Error().Err(err).Msg("查询黑名单列表失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}

	if entries == nil {
		entries = []repo.BlacklistEntry{}
	}

	c.JSON(http.StatusOK, gin.H{"data": entries})
}

// Add 添加黑名单
// POST /api/v1/blacklist
func (h *BlacklistHandler) Add(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req AddBlacklistRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 解析目标用户 ID：优先 identifier，其次 blocked_user_id
	var blockedUserID uuid.UUID
	var err error
	switch {
	case req.Identifier != "":
		blockedUserID, err = h.resolveIdentifier(c, req.Identifier)
	case req.BlockedUserID != "":
		blockedUserID, err = uuid.Parse(req.BlockedUserID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的用户 ID"})
			return
		}
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 blocked_user_id 或 identifier"})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if blockedUserID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不能拉黑自己"})
		return
	}

	// 验证目标用户存在
	target, err := h.userRepo.FindByID(c.Request.Context(), blockedUserID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "目标用户不存在"})
		return
	}

	entry, err := h.blacklistRepo.Add(c.Request.Context(), userID, blockedUserID)
	if err != nil {
		log.Error().Err(err).Msg("添加黑名单失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "添加失败"})
		return
	}

	// 填充被拉黑用户信息
	entry.BlockedName = target.Username
	entry.BlockedCompany = target.CompanyName

	c.JSON(http.StatusOK, gin.H{"data": entry})
}

// resolveIdentifier 将 identifier（UUID / 公司名称 / 用户名）解析为目标用户 ID
// 解析优先级：UUID → 公司名称（大小写不敏感精确匹配）→ 用户名
func (h *BlacklistHandler) resolveIdentifier(c *gin.Context, identifier string) (uuid.UUID, error) {
	// 1. 尝试作为 UUID 直接解析
	if id, err := uuid.Parse(identifier); err == nil {
		return id, nil
	}

	// 2. 按公司名称查找（大小写不敏感精确匹配）
	byCompany, err := h.userRepo.FindByCompanyName(c.Request.Context(), identifier)
	if err != nil {
		return uuid.Nil, fmt.Errorf("查询用户失败")
	}
	switch len(byCompany) {
	case 1:
		return byCompany[0].ID, nil
	case 0:
		// 3. 按用户名精确查找
		byName, err := h.userRepo.FindByUsername(c.Request.Context(), identifier)
		if err == nil {
			return byName.ID, nil
		}
		return uuid.Nil, fmt.Errorf("未找到匹配「%s」的用户", identifier)
	default:
		return uuid.Nil, fmt.Errorf("找到 %d 个匹配「%s」的公司用户，请使用用户 UUID 拉黑", len(byCompany), identifier)
	}
}

// Remove 移除黑名单
// DELETE /api/v1/blacklist/:id
func (h *BlacklistHandler) Remove(c *gin.Context) {
	userID := middleware.GetUserID(c)

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的黑名单 ID"})
		return
	}

	// 也可以通过 blocked_user_id 来移除（前端两种方式都可能用）
	// 检查是否有 blocked_user_id query param
	if buid := c.Query("blocked_user_id"); buid != "" {
		blockedUserID, err := uuid.Parse(buid)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 blocked_user_id"})
			return
		}
		if err := h.blacklistRepo.Remove(c.Request.Context(), userID, blockedUserID); err != nil {
			log.Error().Err(err).Msg("移除黑名单失败")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "移除失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "已移除黑名单"})
		return
	}

	// 按 blacklist 记录 ID 移除
	rows, err := h.blacklistRepo.RemoveByID(c.Request.Context(), id, userID)
	if err != nil {
		log.Error().Err(err).Msg("移除黑名单失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "移除失败"})
		return
	}
	if rows == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "黑名单记录不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "已移除黑名单"})
}

// SearchUsers 搜索已注册用户（按公司名称或用户名模糊匹配），用于黑名单添加时的联想
// GET /api/v1/users/search?q=xxx
func (h *BlacklistHandler) SearchUsers(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		c.JSON(http.StatusOK, gin.H{"data": []interface{}{}})
		return
	}

	users, err := h.userRepo.SearchByCompanyOrUsername(c.Request.Context(), q)
	if err != nil {
		log.Error().Err(err).Msg("搜索用户失败")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "搜索失败"})
		return
	}
	if users == nil {
		users = []*repo.User{}
	}
	c.JSON(http.StatusOK, gin.H{"data": users})
}
