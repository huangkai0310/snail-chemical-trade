package repo

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ProductContract 品种+交割期合约（首次挂盘时建立）
type ProductContract struct {
	ID              int64      `json:"id"`
	ProductID       string     `json:"product_id"`
	DeliveryPeriod  string     `json:"delivery_period"`
	CreatedBy       *uuid.UUID `json:"created_by,omitempty"`
	FirstListingID  *uuid.UUID `json:"first_listing_id,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

type ProductContractRepo struct {
	pool *pgxpool.Pool
}

func NewProductContractRepo(pool *pgxpool.Pool) *ProductContractRepo {
	return &ProductContractRepo{pool: pool}
}

func NormalizeContractPeriod(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return "现货"
	}
	return p
}

// Ensure 若合约不存在则创建（首次发布建立）
func (r *ProductContractRepo) Ensure(ctx context.Context, productID, deliveryPeriod string, createdBy uuid.UUID, listingID *uuid.UUID) (bool, error) {
	productID = strings.TrimSpace(productID)
	deliveryPeriod = NormalizeContractPeriod(deliveryPeriod)
	if productID == "" {
		return false, nil
	}
	tag, err := r.pool.Exec(ctx, `
		INSERT INTO product_contracts (product_id, delivery_period, created_by, first_listing_id)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (product_id, delivery_period) DO NOTHING`,
		productID, deliveryPeriod, createdBy, listingID,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ListByProduct 某品种已建立的交割期合约（现货优先，其余按建立时间）
func (r *ProductContractRepo) ListByProduct(ctx context.Context, productID string) ([]ProductContract, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, product_id, delivery_period, created_by, first_listing_id, created_at
		FROM product_contracts
		WHERE product_id = $1
		ORDER BY
			CASE WHEN delivery_period = '现货' THEN 0 ELSE 1 END,
			created_at ASC`, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []ProductContract
	for rows.Next() {
		var c ProductContract
		if err := rows.Scan(&c.ID, &c.ProductID, &c.DeliveryPeriod, &c.CreatedBy, &c.FirstListingID, &c.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, c)
	}
	return items, rows.Err()
}

// ListAll 全部已建立合约
func (r *ProductContractRepo) ListAll(ctx context.Context) ([]ProductContract, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, product_id, delivery_period, created_by, first_listing_id, created_at
		FROM product_contracts
		ORDER BY product_id,
			CASE WHEN delivery_period = '现货' THEN 0 ELSE 1 END,
			created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []ProductContract
	for rows.Next() {
		var c ProductContract
		if err := rows.Scan(&c.ID, &c.ProductID, &c.DeliveryPeriod, &c.CreatedBy, &c.FirstListingID, &c.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, c)
	}
	return items, rows.Err()
}

// PeriodsForProduct 仅返回交割期字符串列表
func (r *ProductContractRepo) PeriodsForProduct(ctx context.Context, productID string) ([]string, error) {
	contracts, err := r.ListByProduct(ctx, productID)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(contracts))
	for _, c := range contracts {
		out = append(out, c.DeliveryPeriod)
	}
	// 兜底：至少有现货
	if len(out) == 0 {
		return []string{"现货"}, nil
	}
	return out, nil
}

// Exists 合约是否已建立
func (r *ProductContractRepo) Exists(ctx context.Context, productID, deliveryPeriod string) (bool, error) {
	var id int64
	err := r.pool.QueryRow(ctx, `
		SELECT id FROM product_contracts
		WHERE product_id = $1 AND delivery_period = $2`,
		productID, NormalizeContractPeriod(deliveryPeriod),
	).Scan(&id)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

// CountActiveRefs 活跃引用数：OPEN/PARTIAL/SCHEDULED 挂盘 + OPEN/SCHEDULED 换盘腿
func (r *ProductContractRepo) CountActiveRefs(ctx context.Context, productID, deliveryPeriod string) (int64, error) {
	productID = strings.TrimSpace(productID)
	deliveryPeriod = NormalizeContractPeriod(deliveryPeriod)
	if productID == "" {
		return 0, nil
	}

	var listingN, swapN int64
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM listings
		WHERE product_id = $1
		  AND status IN ('OPEN','PARTIAL','SCHEDULED')
		  AND CASE WHEN delivery_period IS NULL OR TRIM(delivery_period) = '' THEN '现货'
		           ELSE TRIM(delivery_period) END = $2`,
		productID, deliveryPeriod,
	).Scan(&listingN)
	if err != nil {
		return 0, err
	}

	err = r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM swap_listings
		WHERE status IN ('OPEN','SCHEDULED')
		  AND (
		    (sell_product_id = $1 AND CASE WHEN sell_delivery_period IS NULL OR TRIM(sell_delivery_period) = '' THEN '现货'
		                                  ELSE TRIM(sell_delivery_period) END = $2)
		    OR
		    (buy_product_id = $1 AND CASE WHEN buy_delivery_period IS NULL OR TRIM(buy_delivery_period) = '' THEN '现货'
		                                 ELSE TRIM(buy_delivery_period) END = $2)
		  )`,
		productID, deliveryPeriod,
	).Scan(&swapN)
	if err != nil {
		return 0, err
	}
	return listingN + swapN, nil
}

// CountTrades 该品种+交割期是否已有成交（有成交则合约永久保留）
func (r *ProductContractRepo) CountTrades(ctx context.Context, productID, deliveryPeriod string) (int64, error) {
	productID = strings.TrimSpace(productID)
	deliveryPeriod = NormalizeContractPeriod(deliveryPeriod)
	if productID == "" {
		return 0, nil
	}
	var n int64
	var err error
	if deliveryPeriod == "现货" {
		err = r.pool.QueryRow(ctx, `
			SELECT COUNT(*) FROM trades
			WHERE product_id = $1
			  AND (delivery_period IS NULL OR BTRIM(delivery_period) = '' OR delivery_period = '现货')`,
			productID,
		).Scan(&n)
	} else {
		err = r.pool.QueryRow(ctx, `
			SELECT COUNT(*) FROM trades
			WHERE product_id = $1 AND delivery_period = $2`,
			productID, deliveryPeriod,
		).Scan(&n)
	}
	return n, err
}

// TryDeleteIfUnused 若无活跃引用且从未成交，则删除合约；现货合约永不删。
// 规则：只要该合约有过成交，即使最后一笔盘被撤/过期，合约也永久保留。
func (r *ProductContractRepo) TryDeleteIfUnused(ctx context.Context, productID, deliveryPeriod string) (bool, error) {
	productID = strings.TrimSpace(productID)
	deliveryPeriod = NormalizeContractPeriod(deliveryPeriod)
	if productID == "" || deliveryPeriod == "现货" {
		return false, nil
	}
	n, err := r.CountActiveRefs(ctx, productID, deliveryPeriod)
	if err != nil {
		return false, err
	}
	if n > 0 {
		return false, nil
	}
	trades, err := r.CountTrades(ctx, productID, deliveryPeriod)
	if err != nil {
		return false, err
	}
	if trades > 0 {
		return false, nil
	}
	tag, err := r.pool.Exec(ctx, `
		DELETE FROM product_contracts
		WHERE product_id = $1 AND delivery_period = $2`,
		productID, deliveryPeriod,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// Delete 强制删除合约（现货不可删）。交割已过定时清理用。
func (r *ProductContractRepo) Delete(ctx context.Context, productID, deliveryPeriod string) (bool, error) {
	productID = strings.TrimSpace(productID)
	deliveryPeriod = NormalizeContractPeriod(deliveryPeriod)
	if productID == "" || deliveryPeriod == "现货" {
		return false, nil
	}
	tag, err := r.pool.Exec(ctx, `
		DELETE FROM product_contracts
		WHERE product_id = $1 AND delivery_period = $2`,
		productID, deliveryPeriod,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ListNonSpot 非现货合约列表
func (r *ProductContractRepo) ListNonSpot(ctx context.Context) ([]ProductContract, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, product_id, delivery_period, created_by, first_listing_id, created_at
		FROM product_contracts
		WHERE delivery_period <> '现货'
		ORDER BY product_id, delivery_period`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []ProductContract
	for rows.Next() {
		var c ProductContract
		if err := rows.Scan(&c.ID, &c.ProductID, &c.DeliveryPeriod, &c.CreatedBy, &c.FirstListingID, &c.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, c)
	}
	return items, rows.Err()
}

// ForceExpireSwapsByContract 将引用该品种+交割期的活跃换盘强制过期
func (r *ProductContractRepo) ForceExpireSwapsByContract(ctx context.Context, productID, deliveryPeriod string) (int64, error) {
	productID = strings.TrimSpace(productID)
	deliveryPeriod = NormalizeContractPeriod(deliveryPeriod)
	if productID == "" || deliveryPeriod == "现货" {
		return 0, nil
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE swap_listings
		SET status = 'EXPIRED', updated_at = NOW()
		WHERE status IN ('OPEN','SCHEDULED')
		  AND (
		    (sell_product_id = $1 AND CASE WHEN sell_delivery_period IS NULL OR TRIM(sell_delivery_period) = '' THEN '现货'
		                                  ELSE TRIM(sell_delivery_period) END = $2)
		    OR
		    (buy_product_id = $1 AND CASE WHEN buy_delivery_period IS NULL OR TRIM(buy_delivery_period) = '' THEN '现货'
		                                 ELSE TRIM(buy_delivery_period) END = $2)
		  )`,
		productID, deliveryPeriod,
	)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
