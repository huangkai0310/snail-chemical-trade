package repo

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huangkai0310/snail-chemical-trade/matching-engine"
)

// walRepo 实现 engine.WALWriter 接口，将撮合操作日志持久化到数据库
type walRepo struct {
	pool *pgxpool.Pool
}

func NewWALRepo(pool *pgxpool.Pool) *walRepo {
	return &walRepo{pool: pool}
}

// Append 写入一条 WAL 日志
func (w *walRepo) Append(entry engine.WALEntry) error {
	id := entry.ID
	if id == "" {
		id = uuid.New().String()
	}
	_, err := w.pool.Exec(context.Background(),
		`INSERT INTO engine_wal (id, action, order_id, product_id, side, price, quantity, user_id, timestamp)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		id, string(entry.Action), entry.OrderID, entry.ProductID,
		string(entry.Side), entry.Price, entry.Quantity, entry.UserID, entry.Timestamp,
	)
	return err
}

// ListWAL 按时间顺序读取 WAL 日志（用于重放恢复）
func (w *walRepo) ListWAL(ctx context.Context, limit int) ([]engine.WALEntry, error) {
	if limit <= 0 {
		limit = 10000
	}
	rows, err := w.pool.Query(ctx,
		`SELECT id, action, order_id, product_id, side, price, quantity, user_id, timestamp
		 FROM engine_wal ORDER BY timestamp ASC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []engine.WALEntry
	for rows.Next() {
		var e engine.WALEntry
		var action, side string
		if err := rows.Scan(&e.ID, &action, &e.OrderID, &e.ProductID, &side,
			&e.Price, &e.Quantity, &e.UserID, &e.Timestamp); err != nil {
			return nil, err
		}
		e.Action = engine.WALAction(action)
		e.Side = engine.Side(side)
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// CleanupBefore 删除指定时间之前的 WAL 日志
func (w *walRepo) CleanupBefore(ctx context.Context, before time.Time) error {
	_, err := w.pool.Exec(ctx, `DELETE FROM engine_wal WHERE timestamp < $1`, before)
	return err
}
