package repo

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Product struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	NameEn    *string   `json:"name_en,omitempty"`
	Unit      string    `json:"unit"`
	Category  *string   `json:"category,omitempty"`
	SortOrder int       `json:"sort_order"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
}

type ProductRepo struct {
	pool *pgxpool.Pool
}

func NewProductRepo(pool *pgxpool.Pool) *ProductRepo {
	return &ProductRepo{pool: pool}
}

// List 查询启用的品种（用户端）
func (r *ProductRepo) List(ctx context.Context) ([]Product, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, name, name_en, unit, category, sort_order, active, created_at
		 FROM products WHERE active = true ORDER BY sort_order`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.Name, &p.NameEn, &p.Unit, &p.Category, &p.SortOrder, &p.Active, &p.CreatedAt); err != nil {
			return nil, err
		}
		products = append(products, p)
	}
	return products, rows.Err()
}

// ListAll 查询全部品种（含禁用，管理后台用）
func (r *ProductRepo) ListAll(ctx context.Context) ([]Product, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, name, name_en, unit, category, sort_order, active, created_at
		 FROM products ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.Name, &p.NameEn, &p.Unit, &p.Category, &p.SortOrder, &p.Active, &p.CreatedAt); err != nil {
			return nil, err
		}
		products = append(products, p)
	}
	return products, rows.Err()
}

// GetByID 按 ID 查询品种
func (r *ProductRepo) GetByID(ctx context.Context, id string) (*Product, error) {
	p := &Product{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, name, name_en, unit, category, sort_order, active, created_at
		 FROM products WHERE id = $1`, id,
	).Scan(&p.ID, &p.Name, &p.NameEn, &p.Unit, &p.Category, &p.SortOrder, &p.Active, &p.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return p, nil
}

// Create 创建品种
func (r *ProductRepo) Create(ctx context.Context, id, name string, nameEn *string, unit string, category *string, sortOrder int) (*Product, error) {
	p := &Product{}
	err := r.pool.QueryRow(ctx,
		`INSERT INTO products (id, name, name_en, unit, category, sort_order, active)
		 VALUES ($1, $2, $3, $4, $5, $6, true)
		 RETURNING id, name, name_en, unit, category, sort_order, active, created_at`,
		id, name, nameEn, unit, category, sortOrder,
	).Scan(&p.ID, &p.Name, &p.NameEn, &p.Unit, &p.Category, &p.SortOrder, &p.Active, &p.CreatedAt)
	if err != nil {
		return nil, err
	}
	return p, nil
}

// Update 更新品种
func (r *ProductRepo) Update(ctx context.Context, id, name string, nameEn *string, unit string, category *string, sortOrder int, active bool) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE products SET name = $1, name_en = $2, unit = $3, category = $4, sort_order = $5, active = $6
		 WHERE id = $7`,
		name, nameEn, unit, category, sortOrder, active, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete 删除品种（硬删除，注意外键约束）
func (r *ProductRepo) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM products WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
