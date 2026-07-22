package handler

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BlacklistCheckerImpl 实现 engine.BlacklistChecker 接口
// 使用本地缓存（5秒 TTL）减少 DB 查询频率
type BlacklistCheckerImpl struct {
	pool *pgxpool.Pool
	mu   sync.RWMutex
	// cache: userID -> {blockedSet, expiry}
	cache map[string]*blacklistCacheEntry
	ttl   time.Duration
}

type blacklistCacheEntry struct {
	blocked map[string]bool
	expiry  time.Time
}

func NewBlacklistCheckerImpl(pool *pgxpool.Pool) *BlacklistCheckerImpl {
	return &BlacklistCheckerImpl{
		pool:  pool,
		cache: make(map[string]*blacklistCacheEntry),
		ttl:   5 * time.Second,
	}
}

// IsBlocked 检查 takerID 是否拉黑了 makerID
func (bc *BlacklistCheckerImpl) IsBlocked(takerID, makerID string) bool {
	// 尝试从缓存读取
	bc.mu.RLock()
	entry, ok := bc.cache[takerID]
	bc.mu.RUnlock()

	if ok && time.Now().Before(entry.expiry) {
		return entry.blocked[makerID]
	}

	// 缓存未命中或过期，从 DB 查询
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	takerUUID, err := uuid.Parse(takerID)
	if err != nil {
		return false
	}

	rows, err := bc.pool.Query(ctx,
		`SELECT blocked_user_id FROM user_blacklist WHERE user_id=$1`, takerUUID)
	if err != nil {
		return false
	}
	defer rows.Close()

	blockedSet := make(map[string]bool)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			continue
		}
		blockedSet[id.String()] = true
	}

	// 更新缓存
	bc.mu.Lock()
	bc.cache[takerID] = &blacklistCacheEntry{
		blocked: blockedSet,
		expiry:  time.Now().Add(bc.ttl),
	}
	bc.mu.Unlock()

	return blockedSet[makerID]
}
