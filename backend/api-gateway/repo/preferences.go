package repo

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// UserPreferences 用户界面偏好（按账号持久化）
type UserPreferences struct {
	UserID       uuid.UUID       `json:"user_id"`
	Favorites    []string        `json:"favorites"`
	TradingView  json.RawMessage `json:"trading_view"`
	WatchlistTab string          `json:"watchlist_tab"`
	LastRoute    *string         `json:"last_route,omitempty"`
	Theme        *string         `json:"theme,omitempty"` // dark | light；nil=未设置
	// PostingPrefs 上一发盘模板：{"listing":{key:obj},"swap":{key:obj}}
	PostingPrefs json.RawMessage `json:"posting_prefs"`
	// SoundPrefs 铃声：{"enabled":true}
	SoundPrefs json.RawMessage `json:"sound_prefs"`
	UpdatedAt  time.Time       `json:"updated_at"`
}

type PreferencesRepo struct {
	pool *pgxpool.Pool
}

func NewPreferencesRepo(pool *pgxpool.Pool) *PreferencesRepo {
	return &PreferencesRepo{pool: pool}
}

func emptyTradingView() json.RawMessage {
	return json.RawMessage(`{}`)
}

func emptyPostingPrefs() json.RawMessage {
	return json.RawMessage(`{"listing":{},"swap":{}}`)
}

func emptySoundPrefs() json.RawMessage {
	return json.RawMessage(`{"enabled":true}`)
}

func normalizeThemePtr(t *string) *string {
	if t == nil {
		return nil
	}
	if *t != "light" && *t != "dark" {
		return nil
	}
	return t
}

// GetOrCreate 读取偏好；不存在则创建默认行
func (r *PreferencesRepo) GetOrCreate(ctx context.Context, userID uuid.UUID) (*UserPreferences, error) {
	p := &UserPreferences{}
	var favRaw, tvRaw, ppRaw, spRaw []byte
	err := r.pool.QueryRow(ctx,
		`INSERT INTO user_preferences (user_id) VALUES ($1)
		 ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
		 RETURNING user_id, favorites, trading_view, watchlist_tab, last_route, theme, posting_prefs, sound_prefs, updated_at`,
		userID,
	).Scan(&p.UserID, &favRaw, &tvRaw, &p.WatchlistTab, &p.LastRoute, &p.Theme, &ppRaw, &spRaw, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	normalizePreferences(p, favRaw, tvRaw, ppRaw, spRaw)
	return p, nil
}

func normalizePreferences(p *UserPreferences, favRaw, tvRaw, ppRaw, spRaw []byte) {
	if err := json.Unmarshal(favRaw, &p.Favorites); err != nil || p.Favorites == nil {
		p.Favorites = []string{}
	}
	if len(tvRaw) == 0 {
		p.TradingView = emptyTradingView()
	} else {
		p.TradingView = json.RawMessage(tvRaw)
	}
	if len(ppRaw) == 0 {
		p.PostingPrefs = emptyPostingPrefs()
	} else {
		p.PostingPrefs = json.RawMessage(ppRaw)
	}
	if len(spRaw) == 0 {
		p.SoundPrefs = emptySoundPrefs()
	} else {
		p.SoundPrefs = json.RawMessage(spRaw)
	}
	p.Theme = normalizeThemePtr(p.Theme)
}

// Update 全量或局部更新（非 nil 字段写入）
func (r *PreferencesRepo) Update(ctx context.Context, userID uuid.UUID, favorites *[]string, tradingView json.RawMessage, watchlistTab *string, lastRoute *string, theme *string, soundPrefs json.RawMessage) (*UserPreferences, error) {
	// 确保行存在
	if _, err := r.GetOrCreate(ctx, userID); err != nil {
		return nil, err
	}

	var favArg interface{}
	if favorites != nil {
		b, err := json.Marshal(*favorites)
		if err != nil {
			return nil, err
		}
		favArg = b
	}

	var tvArg interface{}
	if tradingView != nil {
		if !json.Valid(tradingView) {
			tradingView = emptyTradingView()
		}
		tvArg = []byte(tradingView)
	}

	var tabArg interface{}
	if watchlistTab != nil {
		tabArg = *watchlistTab
	}

	var routeArg interface{}
	if lastRoute != nil {
		routeArg = *lastRoute
	}

	var themeArg interface{}
	if theme != nil {
		t := normalizeThemePtr(theme)
		if t != nil {
			themeArg = *t
		}
	}

	var soundArg interface{}
	if soundPrefs != nil {
		if !json.Valid(soundPrefs) {
			soundPrefs = emptySoundPrefs()
		}
		soundArg = []byte(soundPrefs)
	}

	p := &UserPreferences{}
	var favRaw, tvRaw, ppRaw, spRaw []byte
	err := r.pool.QueryRow(ctx,
		`UPDATE user_preferences SET
		    favorites = COALESCE($2::jsonb, favorites),
		    trading_view = COALESCE($3::jsonb, trading_view),
		    watchlist_tab = COALESCE($4::text, watchlist_tab),
		    last_route = COALESCE($5::text, last_route),
		    theme = COALESCE($6::text, theme),
		    sound_prefs = COALESCE($7::jsonb, sound_prefs),
		    updated_at = NOW()
		 WHERE user_id = $1
		 RETURNING user_id, favorites, trading_view, watchlist_tab, last_route, theme, posting_prefs, sound_prefs, updated_at`,
		userID, favArg, tvArg, tabArg, routeArg, themeArg, soundArg,
	).Scan(&p.UserID, &favRaw, &tvRaw, &p.WatchlistTab, &p.LastRoute, &p.Theme, &ppRaw, &spRaw, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	normalizePreferences(p, favRaw, tvRaw, ppRaw, spRaw)
	return p, nil
}

const maxPostingKeysPerKind = 80
const maxPostingPayloadBytes = 16 * 1024

// ErrPostingPrefTooLarge 单条发盘偏好过大
var ErrPostingPrefTooLarge = errPostingPrefTooLarge{}

type errPostingPrefTooLarge struct{}

func (errPostingPrefTooLarge) Error() string { return "posting pref too large" }

// UpsertPostingPref 写入某一条上一发盘模板（kind=listing|swap）
func (r *PreferencesRepo) UpsertPostingPref(ctx context.Context, userID uuid.UUID, kind, key string, data json.RawMessage) (*UserPreferences, error) {
	if kind != "listing" && kind != "swap" {
		kind = "listing"
	}
	if key == "" || len(key) > 256 {
		return r.GetOrCreate(ctx, userID)
	}
	if len(data) == 0 || !json.Valid(data) {
		data = json.RawMessage(`{}`)
	}
	if len(data) > maxPostingPayloadBytes {
		return nil, ErrPostingPrefTooLarge
	}

	cur, err := r.GetOrCreate(ctx, userID)
	if err != nil {
		return nil, err
	}

	root := map[string]json.RawMessage{}
	_ = json.Unmarshal(cur.PostingPrefs, &root)
	if root == nil {
		root = map[string]json.RawMessage{}
	}

	bucket := map[string]json.RawMessage{}
	if raw, ok := root[kind]; ok && len(raw) > 0 {
		_ = json.Unmarshal(raw, &bucket)
	}
	if bucket == nil {
		bucket = map[string]json.RawMessage{}
	}
	bucket[key] = json.RawMessage(append(json.RawMessage(nil), data...))

	if len(bucket) > maxPostingKeysPerKind {
		for k := range bucket {
			if k == key {
				continue
			}
			delete(bucket, k)
			if len(bucket) <= maxPostingKeysPerKind {
				break
			}
		}
	}

	bucketRaw, err := json.Marshal(bucket)
	if err != nil {
		return nil, err
	}
	root[kind] = bucketRaw
	if _, ok := root["listing"]; !ok {
		root["listing"] = json.RawMessage(`{}`)
	}
	if _, ok := root["swap"]; !ok {
		root["swap"] = json.RawMessage(`{}`)
	}
	raw, err := json.Marshal(root)
	if err != nil {
		return nil, err
	}

	p := &UserPreferences{}
	var favRaw, tvRaw, ppRaw, spRaw []byte
	err = r.pool.QueryRow(ctx,
		`UPDATE user_preferences SET posting_prefs = $2::jsonb, updated_at = NOW()
		 WHERE user_id = $1
		 RETURNING user_id, favorites, trading_view, watchlist_tab, last_route, theme, posting_prefs, sound_prefs, updated_at`,
		userID, raw,
	).Scan(&p.UserID, &favRaw, &tvRaw, &p.WatchlistTab, &p.LastRoute, &p.Theme, &ppRaw, &spRaw, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	normalizePreferences(p, favRaw, tvRaw, ppRaw, spRaw)
	return p, nil
}

// FavoriteContractKey 自选键：productId:deliveryPeriod
func FavoriteContractKey(productID, deliveryPeriod string) string {
	return strings.TrimSpace(productID) + ":" + NormalizeContractPeriod(deliveryPeriod)
}

// RemoveFavoriteKeyFromAll 从所有用户自选中移除指定 productId:deliveryPeriod 键
func (r *PreferencesRepo) RemoveFavoriteKeyFromAll(ctx context.Context, key string) (int64, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return 0, nil
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE user_preferences
		SET favorites = COALESCE((
			SELECT jsonb_agg(to_jsonb(x))
			FROM jsonb_array_elements_text(COALESCE(favorites, '[]'::jsonb)) AS t(x)
			WHERE x <> $1
		), '[]'::jsonb),
		    updated_at = NOW()
		WHERE favorites @> to_jsonb($1::text)`, key)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
