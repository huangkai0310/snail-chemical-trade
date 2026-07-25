package repo

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DictItem 通用字典项（6张字典表结构一致）
type DictItem struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	SortOrder int       `json:"sort_order"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
}

// FreeStorageDefault 免仓默认值（比通用字典多 days + min_quantity 字段）
type FreeStorageDefault struct {
	ID           int     `json:"id"`
	Name         string  `json:"name"`
	Days         int     `json:"days"`
	MinQuantity  float64 `json:"min_quantity"`
	SortOrder    int     `json:"sort_order"`
	Active       bool    `json:"active"`
	CreatedAt    time.Time `json:"created_at"`
}

// DictRepo 通用字典表数据访问层
// 支持6张字典表：dict_delivery_periods / dict_delivery_locations / dict_product_specs /
// dict_payment_methods / dict_delivery_methods / dict_free_storage_defaults
type DictRepo struct {
	pool    *pgxpool.Pool
	table   string
	hasExtra bool // true = dict_free_storage_defaults（含 days/min_quantity 字段）
}

// NewDictRepo 创建通用字典 repo，tableName 为表名
func NewDictRepo(pool *pgxpool.Pool, tableName string) *DictRepo {
	return &DictRepo{
		pool:    pool,
		table:   tableName,
		hasExtra: tableName == "dict_free_storage_defaults",
	}
}

// 便捷构造函数
func NewDeliveryPeriodRepo(pool *pgxpool.Pool) *DictRepo {
	return NewDictRepo(pool, "dict_delivery_periods")
}
func NewDeliveryLocationRepo(pool *pgxpool.Pool) *DictRepo {
	return NewDictRepo(pool, "dict_delivery_locations")
}
func NewProductSpecRepo(pool *pgxpool.Pool) *DictRepo {
	return NewDictRepo(pool, "dict_product_specs")
}
func NewPaymentMethodRepo(pool *pgxpool.Pool) *DictRepo {
	return NewDictRepo(pool, "dict_payment_methods")
}
func NewDeliveryMethodRepo(pool *pgxpool.Pool) *DictRepo {
	return NewDictRepo(pool, "dict_delivery_methods")
}
func NewFreeStorageDefaultRepo(pool *pgxpool.Pool) *DictRepo {
	return NewDictRepo(pool, "dict_free_storage_defaults")
}

// List 查询全部字典项（按 sort_order 排序）
func (r *DictRepo) List(ctx context.Context) (interface{}, error) {
	if r.hasExtra {
		return r.ListFreeStorage(ctx)
	}
	return r.ListSimple(ctx)
}

// ListSimple 查询通用字典项
func (r *DictRepo) ListSimple(ctx context.Context) ([]DictItem, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, name, sort_order, active, created_at FROM `+r.table+
			` ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []DictItem
	for rows.Next() {
		var d DictItem
		if err := rows.Scan(&d.ID, &d.Name, &d.SortOrder, &d.Active, &d.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, d)
	}
	return items, rows.Err()
}

// ListFreeStorage 查询免仓默认值列表
func (r *DictRepo) ListFreeStorage(ctx context.Context) ([]FreeStorageDefault, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, name, days, min_quantity, sort_order, active, created_at FROM `+r.table+
			` ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []FreeStorageDefault
	for rows.Next() {
		var d FreeStorageDefault
		if err := rows.Scan(&d.ID, &d.Name, &d.Days, &d.MinQuantity, &d.SortOrder, &d.Active, &d.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, d)
	}
	return items, rows.Err()
}

// ListActive 查询启用的字典项
func (r *DictRepo) ListActive(ctx context.Context) (interface{}, error) {
	if r.hasExtra {
		return r.ListActiveFreeStorage(ctx)
	}
	return r.ListActiveSimple(ctx)
}

// ListActiveSimple 查询启用的通用字典项
func (r *DictRepo) ListActiveSimple(ctx context.Context) ([]DictItem, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, name, sort_order, active, created_at FROM `+r.table+
			` WHERE active = true ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []DictItem
	for rows.Next() {
		var d DictItem
		if err := rows.Scan(&d.ID, &d.Name, &d.SortOrder, &d.Active, &d.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, d)
	}
	return items, rows.Err()
}

// ListActiveFreeStorage 查询启用的免仓默认值
func (r *DictRepo) ListActiveFreeStorage(ctx context.Context) ([]FreeStorageDefault, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, name, days, min_quantity, sort_order, active, created_at FROM `+r.table+
			` WHERE active = true ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []FreeStorageDefault
	for rows.Next() {
		var d FreeStorageDefault
		if err := rows.Scan(&d.ID, &d.Name, &d.Days, &d.MinQuantity, &d.SortOrder, &d.Active, &d.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, d)
	}
	return items, rows.Err()
}

// Create 创建字典项
func (r *DictRepo) Create(ctx context.Context, name string, sortOrder int) (interface{}, error) {
	if r.hasExtra {
		return nil, errors.New("use CreateFreeStorage for dict_free_storage_defaults")
	}
	d := DictItem{}
	err := r.pool.QueryRow(ctx,
		`INSERT INTO `+r.table+` (name, sort_order) VALUES ($1, $2)
		 ON CONFLICT (name) DO NOTHING
		 RETURNING id, name, sort_order, active, created_at`,
		name, sortOrder,
	).Scan(&d.ID, &d.Name, &d.SortOrder, &d.Active, &d.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDuplicate
		}
		return nil, err
	}
	return d, nil
}

// CreateFreeStorage 创建免仓默认值
func (r *DictRepo) CreateFreeStorage(ctx context.Context, name string, days int, minQuantity float64, sortOrder int) (*FreeStorageDefault, error) {
	d := &FreeStorageDefault{}
	err := r.pool.QueryRow(ctx,
		`INSERT INTO `+r.table+` (name, days, min_quantity, sort_order) VALUES ($1, $2, $3, $4)
		 ON CONFLICT (name) DO NOTHING
		 RETURNING id, name, days, min_quantity, sort_order, active, created_at`,
		name, days, minQuantity, sortOrder,
	).Scan(&d.ID, &d.Name, &d.Days, &d.MinQuantity, &d.SortOrder, &d.Active, &d.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDuplicate
		}
		return nil, err
	}
	return d, nil
}

// Update 更新字典项
func (r *DictRepo) Update(ctx context.Context, id int, name string, sortOrder int, active bool) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE `+r.table+` SET name = $1, sort_order = $2, active = $3 WHERE id = $4`,
		name, sortOrder, active, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateFreeStorage 更新免仓默认值
func (r *DictRepo) UpdateFreeStorage(ctx context.Context, id int, name string, days int, minQuantity float64, sortOrder int, active bool) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE `+r.table+` SET name = $1, days = $2, min_quantity = $3, sort_order = $4, active = $5 WHERE id = $6`,
		name, days, minQuantity, sortOrder, active, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete 删除字典项
func (r *DictRepo) Delete(ctx context.Context, id int) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM `+r.table+` WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetByID 按 ID 查询字典项
func (r *DictRepo) GetByID(ctx context.Context, id int) (interface{}, error) {
	if r.hasExtra {
		return r.GetFreeStorageByID(ctx, id)
	}
	return r.GetSimpleByID(ctx, id)
}

// GetSimpleByID 按ID查询通用字典项
func (r *DictRepo) GetSimpleByID(ctx context.Context, id int) (*DictItem, error) {
	d := &DictItem{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, name, sort_order, active, created_at FROM `+r.table+` WHERE id = $1`, id,
	).Scan(&d.ID, &d.Name, &d.SortOrder, &d.Active, &d.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return d, nil
}

// GetFreeStorageByID 按ID查询免仓默认值
func (r *DictRepo) GetFreeStorageByID(ctx context.Context, id int) (*FreeStorageDefault, error) {
	d := &FreeStorageDefault{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, name, days, min_quantity, sort_order, active, created_at FROM `+r.table+` WHERE id = $1`, id,
	).Scan(&d.ID, &d.Name, &d.Days, &d.MinQuantity, &d.SortOrder, &d.Active, &d.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return d, nil
}

// TableName 返回表名（handler 层可能需要）
func (r *DictRepo) TableName() string {
	return r.table
}

// IsFreeStorage 是否为免仓默认值表
func (r *DictRepo) IsFreeStorage() bool {
	return r.hasExtra
}
