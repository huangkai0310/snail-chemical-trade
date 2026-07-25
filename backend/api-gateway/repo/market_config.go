package repo

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MarketConfig 市场配置项
type MarketConfig struct {
	Key         string    `json:"key"`
	Value       string    `json:"value"`
	Description string    `json:"description"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// MarketConfigRepo 市场配置数据访问层
type MarketConfigRepo struct {
	pool *pgxpool.Pool
}

func NewMarketConfigRepo(pool *pgxpool.Pool) *MarketConfigRepo {
	return &MarketConfigRepo{pool: pool}
}

// List 查询全部配置项
func (r *MarketConfigRepo) List(ctx context.Context) ([]MarketConfig, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT key, value, description, updated_at FROM market_config ORDER BY key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []MarketConfig
	for rows.Next() {
		var c MarketConfig
		if err := rows.Scan(&c.Key, &c.Value, &c.Description, &c.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, c)
	}
	return items, rows.Err()
}

// Get 获取单个配置项
func (r *MarketConfigRepo) Get(ctx context.Context, key string) (string, error) {
	var value string
	err := r.pool.QueryRow(ctx,
		`SELECT value FROM market_config WHERE key = $1`, key,
	).Scan(&value)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", err
	}
	return value, nil
}

// GetBool 获取布尔型配置
func (r *MarketConfigRepo) GetBool(ctx context.Context, key string) (bool, error) {
	val, err := r.Get(ctx, key)
	if err != nil {
		return false, err
	}
	return strconv.ParseBool(val)
}

// GetInt 获取整型配置
func (r *MarketConfigRepo) GetInt(ctx context.Context, key string) (int, error) {
	val, err := r.Get(ctx, key)
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(val)
}

// Set 设置配置项（不存在则创建）
func (r *MarketConfigRepo) Set(ctx context.Context, key, value, description string) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO market_config (key, value, description) VALUES ($1, $2, $3)
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = COALESCE(NULLIF(EXCLUDED.description, ''), market_config.description), updated_at = NOW()`,
		key, value, description)
	return err
}

// SetBool 设置布尔型配置
func (r *MarketConfigRepo) SetBool(ctx context.Context, key string, value bool, description string) error {
	return r.Set(ctx, key, strconv.FormatBool(value), description)
}

// SetInt 设置整型配置
func (r *MarketConfigRepo) SetInt(ctx context.Context, key string, value int, description string) error {
	return r.Set(ctx, key, strconv.Itoa(value), description)
}

// Delete 删除配置项
func (r *MarketConfigRepo) Delete(ctx context.Context, key string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM market_config WHERE key = $1`, key)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// IsMarketOpen 检查市场是否开市
func (r *MarketConfigRepo) IsMarketOpen(ctx context.Context) (bool, error) {
	return r.GetBool(ctx, "market_open")
}

// SetMarketOpen 设置市场开闭状态
func (r *MarketConfigRepo) SetMarketOpen(ctx context.Context, open bool, reason string) error {
	if err := r.SetBool(ctx, "market_open", open, "市场是否开市（true=开市/false=闭市）"); err != nil {
		return err
	}
	return r.Set(ctx, "market_close_reason", reason, "闭市原因（如节假日、维护等）")
}
