package repo

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// IndicatorCache 指标缓存数据模型
type IndicatorCache struct {
	ID           int64           `json:"id"`
	ProductID    string          `json:"product_id"`
	DeliveryPeriod string        `json:"delivery_period"`
	Interval     string          `json:"interval"`
	Indicator    string          `json:"indicator"`
	Params       json.RawMessage `json:"params"`
	Value        json.RawMessage `json:"value"`
	ComputedAt   time.Time       `json:"computed_at"`
	DataThrough  time.Time       `json:"data_through"`
	CreatedAt    time.Time       `json:"created_at"`
}

// IndicatorCacheRepo 指标缓存数据访问层
type IndicatorCacheRepo struct {
	pool *pgxpool.Pool
}

func NewIndicatorCacheRepo(pool *pgxpool.Pool) *IndicatorCacheRepo {
	return &IndicatorCacheRepo{pool: pool}
}

// Upsert 插入或更新指标缓存（基于唯一索引 ON CONFLICT）
func (r *IndicatorCacheRepo) Upsert(ctx context.Context, ic *IndicatorCache) error {
	// 确保 params 非空
	if len(ic.Params) == 0 {
		ic.Params = json.RawMessage([]byte("{}"))
	}
	// data_through 默认 NOW()
	if ic.DataThrough.IsZero() {
		ic.DataThrough = time.Now()
	}
	// computed_at 默认 NOW()
	if ic.ComputedAt.IsZero() {
		ic.ComputedAt = time.Now()
	}

	return r.pool.QueryRow(ctx,
		`INSERT INTO indicator_cache (product_id, delivery_period, interval, indicator, params, value, computed_at, data_through)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 ON CONFLICT (product_id, delivery_period, interval, indicator, params)
		 DO UPDATE SET value = EXCLUDED.value, computed_at = EXCLUDED.computed_at, data_through = EXCLUDED.data_through
		 RETURNING id, created_at`,
		ic.ProductID, ic.DeliveryPeriod, ic.Interval, ic.Indicator, ic.Params, ic.Value, ic.ComputedAt, ic.DataThrough,
	).Scan(&ic.ID, &ic.CreatedAt)
}

// Get 查询单个指标缓存（精确匹配 params）
func (r *IndicatorCacheRepo) Get(ctx context.Context, productID, deliveryPeriod, interval, indicator string, params json.RawMessage) (*IndicatorCache, error) {
	if len(params) == 0 {
		params = json.RawMessage([]byte("{}"))
	}

	ic := &IndicatorCache{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, product_id, delivery_period, interval, indicator, params, value, computed_at, data_through, created_at
		 FROM indicator_cache
		 WHERE product_id = $1 AND delivery_period = $2 AND interval = $3 AND indicator = $4 AND params = $5
		 ORDER BY computed_at DESC LIMIT 1`,
		productID, deliveryPeriod, interval, indicator, params,
	).Scan(&ic.ID, &ic.ProductID, &ic.DeliveryPeriod, &ic.Interval, &ic.Indicator, &ic.Params, &ic.Value, &ic.ComputedAt, &ic.DataThrough, &ic.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return ic, nil
}

// List 查询某产品某交割期某周期下的所有指标缓存
func (r *IndicatorCacheRepo) List(ctx context.Context, productID, deliveryPeriod, interval string) ([]IndicatorCache, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, product_id, delivery_period, interval, indicator, params, value, computed_at, data_through, created_at
		 FROM indicator_cache
		 WHERE product_id = $1 AND delivery_period = $2 AND interval = $3
		 ORDER BY indicator, computed_at DESC`,
		productID, deliveryPeriod, interval)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []IndicatorCache
	for rows.Next() {
		var ic IndicatorCache
		if err := rows.Scan(&ic.ID, &ic.ProductID, &ic.DeliveryPeriod, &ic.Interval, &ic.Indicator, &ic.Params, &ic.Value, &ic.ComputedAt, &ic.DataThrough, &ic.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, ic)
	}
	return items, rows.Err()
}

// ListByIndicator 查询某产品某交割期某周期下指定指标的缓存
func (r *IndicatorCacheRepo) ListByIndicator(ctx context.Context, productID, deliveryPeriod, interval, indicator string) ([]IndicatorCache, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, product_id, delivery_period, interval, indicator, params, value, computed_at, data_through, created_at
		 FROM indicator_cache
		 WHERE product_id = $1 AND delivery_period = $2 AND interval = $3 AND indicator = $4
		 ORDER BY computed_at DESC`,
		productID, deliveryPeriod, interval, indicator)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []IndicatorCache
	for rows.Next() {
		var ic IndicatorCache
		if err := rows.Scan(&ic.ID, &ic.ProductID, &ic.DeliveryPeriod, &ic.Interval, &ic.Indicator, &ic.Params, &ic.Value, &ic.ComputedAt, &ic.DataThrough, &ic.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, ic)
	}
	return items, rows.Err()
}

// Delete 删除指定指标缓存
func (r *IndicatorCacheRepo) Delete(ctx context.Context, productID, deliveryPeriod, interval, indicator string, params json.RawMessage) error {
	if len(params) == 0 {
		params = json.RawMessage([]byte("{}"))
	}

	tag, err := r.pool.Exec(ctx,
		`DELETE FROM indicator_cache
		 WHERE product_id = $1 AND delivery_period = $2 AND interval = $3 AND indicator = $4 AND params = $5`,
		productID, deliveryPeriod, interval, indicator, params)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
