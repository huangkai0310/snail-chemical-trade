package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
)

// AdminMiddleware 校验当前用户是否为管理员（role == "admin"）
// 必须在 AuthMiddleware 之后使用
func AdminMiddleware(userRepo *repo.UserRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := GetUserID(c)

		user, err := userRepo.FindByID(c.Request.Context(), userID)
		if err != nil {
			log.Error().Err(err).Str("user_id", userID.String()).Msg("admin auth: user not found")
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "无权访问管理后台"})
			return
		}

		if user.Role != "admin" {
			log.Warn().Str("user_id", userID.String()).Str("role", user.Role).Msg("admin auth: non-admin access denied")
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "需要管理员权限"})
			return
		}

		c.Set("user_role", user.Role)
		c.Next()
	}
}
