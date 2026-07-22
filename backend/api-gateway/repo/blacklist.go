package repo

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BlacklistEntry 黑名单记录
// 业务规则：任一方拉黑后，双方互相看不到对方发盘，且无法成交。
type BlacklistEntry struct {
	ID             uuid.UUID `json:"id"`
	UserID         uuid.UUID `json:"user_id"`
	BlockedUserID  uuid.UUID `json:"blocked_user_id"`
	AllowView      bool      `json:"allow_view"` // 兼容字段；现已固定为 false（双向互不可见）
	BlockedName    string    `json:"blocked_name"`
	BlockedCompany *string   `json:"blocked_company"`
	CreatedAt      time.Time `json:"created_at"`
}

// BlacklistRepo 用户黑名单数据访问层
type BlacklistRepo struct {
	pool *pgxpool.Pool
}

func NewBlacklistRepo(pool *pgxpool.Pool) *BlacklistRepo {
	return &BlacklistRepo{pool: pool}
}

// Add 添加黑名单（幂等）。拉黑即双向互不可见且不可成交。
func (r *BlacklistRepo) Add(ctx context.Context, userID, blockedUserID uuid.UUID) (*BlacklistEntry, error) {
	entry := &BlacklistEntry{}
	err := r.pool.QueryRow(ctx,
		`INSERT INTO user_blacklist (user_id, blocked_user_id, allow_view)
		 VALUES ($1, $2, FALSE)
		 ON CONFLICT (user_id, blocked_user_id) DO UPDATE SET allow_view = FALSE
		 RETURNING id, user_id, blocked_user_id, allow_view, created_at`,
		userID, blockedUserID,
	).Scan(&entry.ID, &entry.UserID, &entry.BlockedUserID, &entry.AllowView, &entry.CreatedAt)
	if err != nil {
		return nil, err
	}
	return entry, nil
}

// Remove 移除黑名单（按被拉黑用户ID）
func (r *BlacklistRepo) Remove(ctx context.Context, userID, blockedUserID uuid.UUID) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM user_blacklist WHERE user_id=$1 AND blocked_user_id=$2`,
		userID, blockedUserID,
	)
	return err
}

// RemoveByID 按 blacklist 记录 ID 移除，返回受影响行数（用于判断记录是否存在）
func (r *BlacklistRepo) RemoveByID(ctx context.Context, id, userID uuid.UUID) (int64, error) {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM user_blacklist WHERE id=$1 AND user_id=$2`,
		id, userID,
	)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// List 查询当前用户的黑名单列表（含被拉黑用户名）
func (r *BlacklistRepo) List(ctx context.Context, userID uuid.UUID) ([]BlacklistEntry, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT b.id, b.user_id, b.blocked_user_id, b.allow_view, u.username, u.company_name, b.created_at
		 FROM user_blacklist b
		 JOIN users u ON u.id = b.blocked_user_id
		 WHERE b.user_id = $1
		 ORDER BY b.created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []BlacklistEntry
	for rows.Next() {
		var e BlacklistEntry
		if err := rows.Scan(&e.ID, &e.UserID, &e.BlockedUserID, &e.AllowView, &e.BlockedName, &e.BlockedCompany, &e.CreatedAt); err != nil {
			continue
		}
		entries = append(entries, e)
	}
	return entries, nil
}

// IsBlocked 检查 blockedUserID 是否在 userID 的黑名单中（单向记录）
func (r *BlacklistRepo) IsBlocked(ctx context.Context, userID, blockedUserID uuid.UUID) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM user_blacklist WHERE user_id=$1 AND blocked_user_id=$2)`,
		userID, blockedUserID,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

// IsEitherBlocked 任一方拉黑了对方则为 true（成交拦截用）
func (r *BlacklistRepo) IsEitherBlocked(ctx context.Context, a, b uuid.UUID) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(
		   SELECT 1 FROM user_blacklist
		   WHERE (user_id=$1 AND blocked_user_id=$2) OR (user_id=$2 AND blocked_user_id=$1)
		 )`,
		a, b,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

// GetBlockedUserIDs 获取当前用户主动拉黑的所有用户ID
func (r *BlacklistRepo) GetBlockedUserIDs(ctx context.Context, userID uuid.UUID) (map[uuid.UUID]bool, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT blocked_user_id FROM user_blacklist WHERE user_id=$1`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[uuid.UUID]bool)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			continue
		}
		result[id] = true
	}
	return result, nil
}

// GetInvisiblePeerIDs 获取与当前用户「互相不可见发盘」的用户 ID：
// 我拉黑的人 + 拉黑了我的人（任一方拉黑即双向互不可见）。
func (r *BlacklistRepo) GetInvisiblePeerIDs(ctx context.Context, userID uuid.UUID) (map[uuid.UUID]bool, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT blocked_user_id FROM user_blacklist WHERE user_id = $1
		 UNION
		 SELECT user_id FROM user_blacklist WHERE blocked_user_id = $1`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[uuid.UUID]bool)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			continue
		}
		result[id] = true
	}
	return result, nil
}

// GetHiddenUserIDs 兼容旧调用，等同 GetInvisiblePeerIDs
func (r *BlacklistRepo) GetHiddenUserIDs(ctx context.Context, userID uuid.UUID) (map[uuid.UUID]bool, error) {
	return r.GetInvisiblePeerIDs(ctx, userID)
}
