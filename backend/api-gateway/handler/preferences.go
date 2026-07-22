package handler

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/middleware"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
)

type PreferencesHandler struct {
	repo *repo.PreferencesRepo
}

func NewPreferencesHandler(r *repo.PreferencesRepo) *PreferencesHandler {
	return &PreferencesHandler{repo: r}
}

// Get GET /api/v1/preferences
func (h *PreferencesHandler) Get(c *gin.Context) {
	userID := middleware.GetUserID(c)
	p, err := h.repo.GetOrCreate(c.Request.Context(), userID)
	if err != nil {
		log.Error().Err(err).Msg("get preferences failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取偏好失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

type updatePreferencesRequest struct {
	Favorites    *[]string       `json:"favorites"`
	TradingView  json.RawMessage `json:"trading_view"`
	WatchlistTab *string         `json:"watchlist_tab"`
	LastRoute    *string         `json:"last_route"`
	Theme        *string         `json:"theme"`
	SoundPrefs   json.RawMessage `json:"sound_prefs"`
	// PostingPref 写入一条上一发盘偏好（服务端合并入库）
	PostingPref *postingPrefUpsert `json:"posting_pref"`
}

type postingPrefUpsert struct {
	Kind string          `json:"kind"` // listing | swap
	Key  string          `json:"key"`
	Data json.RawMessage `json:"data"`
}

// Update PUT /api/v1/preferences
func (h *PreferencesHandler) Update(c *gin.Context) {
	userID := middleware.GetUserID(c)
	var req updatePreferencesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Favorites != nil {
		// 去重、限长，防止滥用
		seen := map[string]bool{}
		clean := make([]string, 0, len(*req.Favorites))
		for _, k := range *req.Favorites {
			if k == "" || seen[k] || len(k) > 128 {
				continue
			}
			seen[k] = true
			clean = append(clean, k)
			if len(clean) >= 200 {
				break
			}
		}
		req.Favorites = &clean
	}

	if req.WatchlistTab != nil {
		t := *req.WatchlistTab
		if t != "favorites" && t != "overview" {
			t = "overview"
			req.WatchlistTab = &t
		}
	}

	if req.LastRoute != nil {
		r := *req.LastRoute
		if len(r) > 128 {
			r = r[:128]
			req.LastRoute = &r
		}
	}

	if req.Theme != nil {
		t := *req.Theme
		if t != "light" && t != "dark" {
			t = "dark"
			req.Theme = &t
		}
	}

	var tv json.RawMessage
	if req.TradingView != nil && len(req.TradingView) > 0 && string(req.TradingView) != "null" {
		if !json.Valid(req.TradingView) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "trading_view 格式无效"})
			return
		}
		tv = req.TradingView
	}

	var soundPrefs json.RawMessage
	if req.SoundPrefs != nil && len(req.SoundPrefs) > 0 && string(req.SoundPrefs) != "null" {
		if !json.Valid(req.SoundPrefs) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "sound_prefs 格式无效"})
			return
		}
		// 规范化：只保留 enabled
		var raw map[string]interface{}
		if err := json.Unmarshal(req.SoundPrefs, &raw); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "sound_prefs 格式无效"})
			return
		}
		norm := map[string]interface{}{
			"enabled": true,
		}
		if v, ok := raw["enabled"].(bool); ok {
			norm["enabled"] = v
		}
		b, _ := json.Marshal(norm)
		soundPrefs = b
	}

	// 先写常规偏好
	hasRegular := req.Favorites != nil || tv != nil || req.WatchlistTab != nil || req.LastRoute != nil || req.Theme != nil || soundPrefs != nil
	var p *repo.UserPreferences
	var err error
	if hasRegular {
		p, err = h.repo.Update(c.Request.Context(), userID, req.Favorites, tv, req.WatchlistTab, req.LastRoute, req.Theme, soundPrefs)
		if err != nil {
			log.Error().Err(err).Msg("update preferences failed")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存偏好失败"})
			return
		}
	}

	if req.PostingPref != nil {
		kind := req.PostingPref.Kind
		if kind != "listing" && kind != "swap" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "posting_pref.kind 须为 listing 或 swap"})
			return
		}
		key := req.PostingPref.Key
		if key == "" || len(key) > 256 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "posting_pref.key 无效"})
			return
		}
		p, err = h.repo.UpsertPostingPref(c.Request.Context(), userID, kind, key, req.PostingPref.Data)
		if err != nil {
			if err == repo.ErrPostingPrefTooLarge {
				c.JSON(http.StatusBadRequest, gin.H{"error": "发盘偏好内容过大"})
				return
			}
			log.Error().Err(err).Msg("upsert posting pref failed")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存发盘偏好失败"})
			return
		}
	}

	if p == nil {
		p, err = h.repo.GetOrCreate(c.Request.Context(), userID)
		if err != nil {
			log.Error().Err(err).Msg("get preferences failed")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "读取偏好失败"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}
