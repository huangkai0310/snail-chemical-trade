package repo

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Trade struct {
	ID         uuid.UUID `json:"id"`
	ProductID  string    `json:"product_id"`
	BuyOrderID uuid.UUID `json:"buy_order_id"`
	SellOrderID uuid.UUID `json:"sell_order_id"`
	BuyUserID  uuid.UUID `json:"buy_user_id"`
	SellUserID uuid.UUID `json:"sell_user_id"`
	Price      float64   `json:"price"`
	Quantity   float64   `json:"quantity"`
	Amount     float64   `json:"amount"`
	TradedAt   time.Time `json:"traded_at"`
}

type TradeRepo struct {
	pool *pgxpool.Pool
}

func NewTradeRepo(pool *pgxpool.Pool) *TradeRepo {
	return &TradeRepo{pool: pool}
}

// Create 记录成交
func (r *TradeRepo) Create(ctx context.Context, t *Trade) error {
	return r.pool.QueryRow(ctx,
		`INSERT INTO trades (product_id, buy_order_id, sell_order_id, buy_user_id, sell_user_id, price, quantity)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 RETURNING id, amount, traded_at`,
		t.ProductID, t.BuyOrderID, t.SellOrderID, t.BuyUserID, t.SellUserID, t.Price, t.Quantity,
	).Scan(&t.ID, &t.Amount, &t.TradedAt)
}

// ListRecent 最近成交记录
func (r *TradeRepo) ListRecent(ctx context.Context, limit int) ([]Trade, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, product_id, buy_order_id, sell_order_id, buy_user_id, sell_user_id,
		        price, quantity, amount, traded_at
		 FROM trades ORDER BY traded_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trades []Trade
	for rows.Next() {
		var t Trade
		if err := rows.Scan(&t.ID, &t.ProductID, &t.BuyOrderID, &t.SellOrderID,
			&t.BuyUserID, &t.SellUserID, &t.Price, &t.Quantity, &t.Amount, &t.TradedAt); err != nil {
			return nil, err
		}
		trades = append(trades, t)
	}
	return trades, rows.Err()
}
