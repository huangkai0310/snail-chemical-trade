package repo

import (
	"context"
	"time"

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
