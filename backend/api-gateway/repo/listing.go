package repo

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ListingStatus string

const (
	ListingOpen      ListingStatus = "OPEN"
	ListingPartial   ListingStatus = "PARTIAL"
	ListingFilled    ListingStatus = "FILLED"
	ListingCancelled ListingStatus = "CANCELLED"
)

type Listing struct {
	ID                uuid.UUID       `json:"id"`
	UserID            uuid.UUID       `json:"user_id"`
	ProductID         string          `json:"product_id"`
	Side              string          `json:"side"`
	Price             float64         `json:"price"`
	Quantity          float64         `json:"quantity"`
	Filled            float64         `json:"filled"`
	Status            ListingStatus   `json:"status"`
	DeliveryPeriod    *string         `json:"delivery_period,omitempty"`
	DeliveryLocation  *string         `json:"delivery_location,omitempty"`
	Specs             json.RawMessage `json:"specs,omitempty"`
	Remark            *string         `json:"remark,omitempty"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

type ListingRepo struct {
	pool *pgxpool.Pool
}

func NewListingRepo(pool *pgxpool.Pool) *ListingRepo {
	return &ListingRepo{pool: pool}
}

// Create 创建挂牌单
func (r *ListingRepo) Create(ctx context.Context, l *Listing) error {
	return r.pool.QueryRow(ctx,
		`INSERT INTO listings (user_id, product_id, side, price, quantity, delivery_period, delivery_location, specs, remark)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 RETURNING id, filled, status, created_at, updated_at`,
		l.UserID, l.ProductID, l.Side, l.Price, l.Quantity,
		l.DeliveryPeriod, l.DeliveryLocation, l.Specs, l.Remark,
	).Scan(&l.ID, &l.Filled, &l.Status, &l.CreatedAt, &l.UpdatedAt)
}

// ListByProduct 查询某品种的活跃挂牌
func (r *ListingRepo) ListByProduct(ctx context.Context, productID string) ([]Listing, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, product_id, side, price, quantity, filled, status,
		        delivery_period, delivery_location, specs, remark, created_at, updated_at
		 FROM listings
		 WHERE product_id = $1 AND status IN ('OPEN','PARTIAL')
		 ORDER BY created_at DESC LIMIT 100`, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var listings []Listing
	for rows.Next() {
		var l Listing
		if err := rows.Scan(&l.ID, &l.UserID, &l.ProductID, &l.Side, &l.Price, &l.Quantity,
			&l.Filled, &l.Status, &l.DeliveryPeriod, &l.DeliveryLocation, &l.Specs, &l.Remark,
			&l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, err
		}
		listings = append(listings, l)
	}
	return listings, rows.Err()
}

// FindByID 按 ID 查挂牌
func (r *ListingRepo) FindByID(ctx context.Context, id uuid.UUID) (*Listing, error) {
	l := &Listing{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, user_id, product_id, side, price, quantity, filled, status,
		        delivery_period, delivery_location, specs, remark, created_at, updated_at
		 FROM listings WHERE id = $1`, id,
	).Scan(&l.ID, &l.UserID, &l.ProductID, &l.Side, &l.Price, &l.Quantity,
		&l.Filled, &l.Status, &l.DeliveryPeriod, &l.DeliveryLocation, &l.Specs, &l.Remark,
		&l.CreatedAt, &l.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return l, nil
}

// Cancel 撤牌
func (r *ListingRepo) Cancel(ctx context.Context, id uuid.UUID, userID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE listings SET status = 'CANCELLED', updated_at = NOW()
		 WHERE id = $1 AND user_id = $2 AND status IN ('OPEN','PARTIAL')`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetUserID 获取挂牌对应的用户 ID
func (r *ListingRepo) GetUserID(ctx context.Context, id uuid.UUID) (uuid.UUID, error) {
	var userID uuid.UUID
	err := r.pool.QueryRow(ctx, `SELECT user_id FROM listings WHERE id = $1`, id).Scan(&userID)
	return userID, err
}

// UpdateFilled 更新已成交量（撮合引擎回调）
func (r *ListingRepo) UpdateFilled(ctx context.Context, id uuid.UUID, filled float64, status ListingStatus) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE listings SET filled = $2, status = $3, updated_at = NOW() WHERE id = $1`,
		id, filled, status)
	return err
}
