package repo

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CounterOfferStatus 还价状态
type CounterOfferStatus string

const (
	COStatusPENDING        CounterOfferStatus = "PENDING"
	COStatusAccepted       CounterOfferStatus = "ACCEPTED"
	COStatusRejected       CounterOfferStatus = "REJECTED"
	COStatusExpired        CounterOfferStatus = "EXPIRED"
	COStatusCancelled      CounterOfferStatus = "CANCELLED"
	COStatusPartialAccepted CounterOfferStatus = "PARTIAL_ACCEPTED"
)

// CounterOffer 还价记录
type CounterOffer struct {
	ID             uuid.UUID          `json:"id"`
	RefType        string             `json:"ref_type"`        // "listing" 或 "swap"
	RefID          uuid.UUID          `json:"ref_id"`          // 关联的挂牌/换盘 ID
	Mode           *string            `json:"mode,omitempty"`  // 仅 swap 有效：sell/buy/both
	NegotiationGroupID *uuid.UUID     `json:"negotiation_group_id,omitempty"` // 双向换盘同批商谈
	OfferUserID    uuid.UUID          `json:"offer_user_id"`   // 还价发起方
	ListingUserID  uuid.UUID          `json:"listing_user_id"` // 挂牌方/换盘方
	OfferPrice     float64            `json:"offer_price"`
	OfferQuantity  float64            `json:"offer_quantity"`
	// 可协商的其他条款（议价方提出，接受后覆盖原盘条款）
	OfferDeliveryPeriod     *string  `json:"offer_delivery_period,omitempty"`
	OfferDeliveryLocation   *string  `json:"offer_delivery_location,omitempty"`
	OfferPaymentMethod      *string  `json:"offer_payment_method,omitempty"`
	OfferDeliveryMethod     *string  `json:"offer_delivery_method,omitempty"`
	OfferFreeStorageEnabled *bool    `json:"offer_free_storage_enabled,omitempty"`
	OfferFreeStorageDays    *int     `json:"offer_free_storage_days,omitempty"`
	OfferSpecs              *string  `json:"offer_specs,omitempty"`
	Status         CounterOfferStatus `json:"status"`
	RejectedReason *string            `json:"rejected_reason,omitempty"`
	CancelReason   *string            `json:"cancel_reason,omitempty"` // 自动撤销原因：对方已成交/对方已撤盘
	AcceptedTerms  json.RawMessage     `json:"accepted_terms,omitempty"` // 部分接受时，挂牌方勾选接受的条款键（JSON 数组）
	RefSide        *string            `json:"ref_side,omitempty"`      // 关联挂牌的买卖方向（仅 listing 类有效：BUY/SELL）
	ProductID      *string            `json:"product_id,omitempty"`    // 关联品种
	RefPrice       *float64           `json:"ref_price,omitempty"`     // 关联挂牌的原价（仅 listing 类有效）
	RefCreatedAt   *time.Time         `json:"ref_created_at,omitempty"` // 关联挂牌的发盘日期（仅 listing 类有效）
	RefSerialNo    *int64             `json:"ref_serial_no,omitempty"`  // 关联挂牌的发盘序号（仅 listing 类有效）
	RefDeliveryMethod     *string     `json:"ref_delivery_method,omitempty"`     // 关联挂牌的交割方式
	RefFreeStorageEnabled *bool       `json:"ref_free_storage_enabled,omitempty"` // 关联挂牌是否可免仓
	RefFreeStorageDays    *int        `json:"ref_free_storage_days,omitempty"`    // 关联挂牌免仓天数
	RefDeliveryPeriod     *string     `json:"ref_delivery_period,omitempty"`      // 关联挂牌交割期
	RefDeliveryLocation   *string     `json:"ref_delivery_location,omitempty"`    // 关联挂牌交割地
	RefPaymentMethod      *string     `json:"ref_payment_method,omitempty"`       // 关联挂牌付款方式
	RefSpecs              *string     `json:"ref_specs,omitempty"`                // 关联挂牌规格（JSON 文本）
	RefQuantity           *float64    `json:"ref_quantity,omitempty"`             // 关联挂牌总量
	RefFilled             *float64    `json:"ref_filled,omitempty"`               // 关联挂牌已成交量
	CreatedAt      time.Time          `json:"created_at"`
	UpdatedAt      time.Time          `json:"updated_at"`
}

type CounterOfferRepo struct {
	pool *pgxpool.Pool
}

func NewCounterOfferRepo(pool *pgxpool.Pool) *CounterOfferRepo {
	return &CounterOfferRepo{pool: pool}
}

// Create 创建还价记录
func (r *CounterOfferRepo) Create(ctx context.Context, co *CounterOffer) error {
	return r.pool.QueryRow(ctx,
		`INSERT INTO counter_offers (ref_type, ref_id, mode, negotiation_group_id, offer_user_id, listing_user_id, offer_price, offer_quantity,
		        offer_delivery_period, offer_delivery_location, offer_payment_method, offer_delivery_method,
		        offer_free_storage_enabled, offer_free_storage_days, offer_specs)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		 RETURNING id, status, created_at, updated_at`,
		co.RefType, co.RefID, co.Mode, co.NegotiationGroupID, co.OfferUserID, co.ListingUserID, co.OfferPrice, co.OfferQuantity,
		co.OfferDeliveryPeriod, co.OfferDeliveryLocation, co.OfferPaymentMethod, co.OfferDeliveryMethod,
		co.OfferFreeStorageEnabled, co.OfferFreeStorageDays, co.OfferSpecs,
	).Scan(&co.ID, &co.Status, &co.CreatedAt, &co.UpdatedAt)
}

// FindByID 按 ID 查询还价
func (r *CounterOfferRepo) FindByID(ctx context.Context, id uuid.UUID) (*CounterOffer, error) {
	co := &CounterOffer{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, ref_type, ref_id, mode, negotiation_group_id, offer_user_id, listing_user_id,
		        offer_price, offer_quantity,
		        offer_delivery_period, offer_delivery_location, offer_payment_method, offer_delivery_method,
		        offer_free_storage_enabled, offer_free_storage_days, offer_specs,
		        status, rejected_reason, cancel_reason, accepted_terms, created_at, updated_at
	 FROM counter_offers WHERE id = $1`, id,
	).Scan(&co.ID, &co.RefType, &co.RefID, &co.Mode, &co.NegotiationGroupID, &co.OfferUserID, &co.ListingUserID,
		&co.OfferPrice, &co.OfferQuantity,
		&co.OfferDeliveryPeriod, &co.OfferDeliveryLocation, &co.OfferPaymentMethod, &co.OfferDeliveryMethod,
		&co.OfferFreeStorageEnabled, &co.OfferFreeStorageDays, &co.OfferSpecs,
		&co.Status, &co.RejectedReason, &co.CancelReason, &co.AcceptedTerms, &co.CreatedAt, &co.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return co, nil
}

// CounterOfferPage 还价分页结果
type CounterOfferPage struct {
	Data      []CounterOffer `json:"data"`
	Total     int            `json:"total"`
	Page      int            `json:"page"`
	PageSize  int            `json:"page_size"`
	TotalPage int            `json:"total_page"`
}

// ListReceived 查询收到的还价（挂牌方视角，支持分页）
func (r *CounterOfferRepo) ListReceived(ctx context.Context, userID uuid.UUID, status string, page int, pageSize int) (*CounterOfferPage, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	// 构建 WHERE 条件（加 co. 前缀避免 JOIN 后 status 列名歧义）
	whereClause := `co.listing_user_id = $1`
	args := []interface{}{userID}
	argIdx := 2

	if status != "" {
		whereClause += ` AND co.status = $` + itoa(argIdx)
		args = append(args, status)
		argIdx++
	}

	// 查询总数
	var total int
	countQuery := `SELECT COUNT(*) FROM counter_offers co WHERE ` + whereClause
	if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, err
	}

	// 查询数据
	dataQuery := `SELECT co.id, co.ref_type, co.ref_id, co.mode, co.negotiation_group_id, co.offer_user_id, co.listing_user_id,
		          co.offer_price, co.offer_quantity,
		          co.offer_delivery_period, co.offer_delivery_location, co.offer_payment_method, co.offer_delivery_method,
		          co.offer_free_storage_enabled, co.offer_free_storage_days, co.offer_specs,
		          co.status, co.rejected_reason, co.cancel_reason, co.accepted_terms, co.created_at, co.updated_at,
		          l.side AS ref_side,
		          COALESCE(l.product_id, CASE co.mode WHEN 'buy' THEN s.buy_product_id ELSE s.sell_product_id END) AS product_id,
		          COALESCE(l.price, CASE co.mode WHEN 'buy' THEN s.buy_price ELSE s.sell_price END) AS ref_price,
		          COALESCE(l.created_at, s.created_at) AS ref_created_at,
		          COALESCE(l.serial_no, s.serial_no) AS ref_serial_no,
		          COALESCE(l.delivery_method, CASE co.mode WHEN 'buy' THEN s.buy_delivery_method ELSE s.sell_delivery_method END) AS ref_delivery_method,
		          COALESCE(l.free_storage_enabled, CASE co.mode WHEN 'buy' THEN s.buy_free_storage_enabled ELSE s.sell_free_storage_enabled END) AS ref_free_storage_enabled,
		          COALESCE(l.free_storage_days, CASE co.mode WHEN 'buy' THEN s.buy_free_storage_days ELSE s.sell_free_storage_days END) AS ref_free_storage_days,
		          COALESCE(l.delivery_period, CASE co.mode WHEN 'buy' THEN s.buy_delivery_period ELSE s.sell_delivery_period END) AS ref_delivery_period,
		          COALESCE(l.delivery_location, CASE co.mode WHEN 'buy' THEN s.buy_delivery_location ELSE s.sell_delivery_location END) AS ref_delivery_location,
		          COALESCE(l.payment_method, CASE co.mode WHEN 'buy' THEN s.buy_payment_method ELSE s.sell_payment_method END) AS ref_payment_method,
		          COALESCE(l.specs::text, CASE co.mode WHEN 'buy' THEN s.buy_specs::text ELSE s.sell_specs::text END) AS ref_specs,
		          COALESCE(l.quantity, CASE co.mode WHEN 'buy' THEN s.buy_quantity ELSE s.sell_quantity END) AS ref_quantity,
		          COALESCE(l.filled, CASE co.mode WHEN 'buy' THEN s.buy_filled ELSE s.sell_filled END) AS ref_filled
		   FROM counter_offers co LEFT JOIN listings l ON co.ref_type = 'listing' AND l.id = co.ref_id
		   LEFT JOIN swap_listings s ON co.ref_type = 'swap' AND s.id = co.ref_id WHERE ` + whereClause +
		` ORDER BY co.created_at DESC LIMIT $` + itoa(argIdx) + ` OFFSET $` + itoa(argIdx+1)
	dataArgs := append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, dataQuery, dataArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []CounterOffer
	for rows.Next() {
		var co CounterOffer
		if err := rows.Scan(&co.ID, &co.RefType, &co.RefID, &co.Mode, &co.NegotiationGroupID, &co.OfferUserID, &co.ListingUserID,
			&co.OfferPrice, &co.OfferQuantity,
			&co.OfferDeliveryPeriod, &co.OfferDeliveryLocation, &co.OfferPaymentMethod, &co.OfferDeliveryMethod,
			&co.OfferFreeStorageEnabled, &co.OfferFreeStorageDays, &co.OfferSpecs,
			&co.Status, &co.RejectedReason, &co.CancelReason, &co.AcceptedTerms, &co.CreatedAt, &co.UpdatedAt,
			&co.RefSide, &co.ProductID, &co.RefPrice, &co.RefCreatedAt, &co.RefSerialNo,
			&co.RefDeliveryMethod, &co.RefFreeStorageEnabled, &co.RefFreeStorageDays, &co.RefDeliveryPeriod, &co.RefDeliveryLocation, &co.RefPaymentMethod, &co.RefSpecs, &co.RefQuantity, &co.RefFilled); err != nil {
			return nil, err
		}
		results = append(results, co)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if results == nil {
		results = []CounterOffer{}
	}

	totalPage := (total + pageSize - 1) / pageSize
	return &CounterOfferPage{
		Data:      results,
		Total:     total,
		Page:      page,
		PageSize:  pageSize,
		TotalPage: totalPage,
	}, nil
}

// ListSent 查询发出的还价（还价方视角，支持分页）
func (r *CounterOfferRepo) ListSent(ctx context.Context, userID uuid.UUID, status string, page int, pageSize int) (*CounterOfferPage, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	// 构建 WHERE 条件（加 co. 前缀避免 JOIN 后 status 列名歧义）
	whereClause := `co.offer_user_id = $1`
	args := []interface{}{userID}
	argIdx := 2

	if status != "" {
		whereClause += ` AND co.status = $` + itoa(argIdx)
		args = append(args, status)
		argIdx++
	}

	// 查询总数
	var total int
	countQuery := `SELECT COUNT(*) FROM counter_offers co WHERE ` + whereClause
	if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, err
	}

	// 查询数据
	dataQuery := `SELECT co.id, co.ref_type, co.ref_id, co.mode, co.negotiation_group_id, co.offer_user_id, co.listing_user_id,
		          co.offer_price, co.offer_quantity,
		          co.offer_delivery_period, co.offer_delivery_location, co.offer_payment_method, co.offer_delivery_method,
		          co.offer_free_storage_enabled, co.offer_free_storage_days, co.offer_specs,
		          co.status, co.rejected_reason, co.cancel_reason, co.accepted_terms, co.created_at, co.updated_at,
		          l.side AS ref_side,
		          COALESCE(l.product_id, CASE co.mode WHEN 'buy' THEN s.buy_product_id ELSE s.sell_product_id END) AS product_id,
		          COALESCE(l.price, CASE co.mode WHEN 'buy' THEN s.buy_price ELSE s.sell_price END) AS ref_price,
		          COALESCE(l.created_at, s.created_at) AS ref_created_at,
		          COALESCE(l.serial_no, s.serial_no) AS ref_serial_no,
		          COALESCE(l.delivery_method, CASE co.mode WHEN 'buy' THEN s.buy_delivery_method ELSE s.sell_delivery_method END) AS ref_delivery_method,
		          COALESCE(l.free_storage_enabled, CASE co.mode WHEN 'buy' THEN s.buy_free_storage_enabled ELSE s.sell_free_storage_enabled END) AS ref_free_storage_enabled,
		          COALESCE(l.free_storage_days, CASE co.mode WHEN 'buy' THEN s.buy_free_storage_days ELSE s.sell_free_storage_days END) AS ref_free_storage_days,
		          COALESCE(l.delivery_period, CASE co.mode WHEN 'buy' THEN s.buy_delivery_period ELSE s.sell_delivery_period END) AS ref_delivery_period,
		          COALESCE(l.delivery_location, CASE co.mode WHEN 'buy' THEN s.buy_delivery_location ELSE s.sell_delivery_location END) AS ref_delivery_location,
		          COALESCE(l.payment_method, CASE co.mode WHEN 'buy' THEN s.buy_payment_method ELSE s.sell_payment_method END) AS ref_payment_method,
		          COALESCE(l.specs::text, CASE co.mode WHEN 'buy' THEN s.buy_specs::text ELSE s.sell_specs::text END) AS ref_specs,
		          COALESCE(l.quantity, CASE co.mode WHEN 'buy' THEN s.buy_quantity ELSE s.sell_quantity END) AS ref_quantity,
		          COALESCE(l.filled, CASE co.mode WHEN 'buy' THEN s.buy_filled ELSE s.sell_filled END) AS ref_filled
		   FROM counter_offers co LEFT JOIN listings l ON co.ref_type = 'listing' AND l.id = co.ref_id
		   LEFT JOIN swap_listings s ON co.ref_type = 'swap' AND s.id = co.ref_id WHERE ` + whereClause +
		` ORDER BY co.created_at DESC LIMIT $` + itoa(argIdx) + ` OFFSET $` + itoa(argIdx+1)
	dataArgs := append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, dataQuery, dataArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []CounterOffer
	for rows.Next() {
		var co CounterOffer
		if err := rows.Scan(&co.ID, &co.RefType, &co.RefID, &co.Mode, &co.NegotiationGroupID, &co.OfferUserID, &co.ListingUserID,
			&co.OfferPrice, &co.OfferQuantity,
			&co.OfferDeliveryPeriod, &co.OfferDeliveryLocation, &co.OfferPaymentMethod, &co.OfferDeliveryMethod,
			&co.OfferFreeStorageEnabled, &co.OfferFreeStorageDays, &co.OfferSpecs,
			&co.Status, &co.RejectedReason, &co.CancelReason, &co.AcceptedTerms, &co.CreatedAt, &co.UpdatedAt,
			&co.RefSide, &co.ProductID, &co.RefPrice, &co.RefCreatedAt, &co.RefSerialNo,
			&co.RefDeliveryMethod, &co.RefFreeStorageEnabled, &co.RefFreeStorageDays, &co.RefDeliveryPeriod, &co.RefDeliveryLocation, &co.RefPaymentMethod, &co.RefSpecs, &co.RefQuantity, &co.RefFilled); err != nil {
			return nil, err
		}
		results = append(results, co)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if results == nil {
		results = []CounterOffer{}
	}

	totalPage := (total + pageSize - 1) / pageSize
	return &CounterOfferPage{
		Data:      results,
		Total:     total,
		Page:      page,
		PageSize:  pageSize,
		TotalPage: totalPage,
	}, nil
}

// ListByRef 查询某个挂牌/换盘下的所有还价（支持分页）
func (r *CounterOfferRepo) ListByRef(ctx context.Context, refType string, refID uuid.UUID, status string, page int, pageSize int) (*CounterOfferPage, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	// 构建 WHERE 条件（加 co. 前缀避免 JOIN 后 status 列名歧义）
	whereClause := `co.ref_type = $1 AND co.ref_id = $2`
	args := []interface{}{refType, refID}
	argIdx := 3

	if status != "" {
		whereClause += ` AND co.status = $` + itoa(argIdx)
		args = append(args, status)
		argIdx++
	}

	// 查询总数
	var total int
	countQuery := `SELECT COUNT(*) FROM counter_offers co WHERE ` + whereClause
	if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, err
	}

	// 查询数据
	dataQuery := `SELECT co.id, co.ref_type, co.ref_id, co.mode, co.negotiation_group_id, co.offer_user_id, co.listing_user_id,
		          co.offer_price, co.offer_quantity,
		          co.offer_delivery_period, co.offer_delivery_location, co.offer_payment_method, co.offer_delivery_method,
		          co.offer_free_storage_enabled, co.offer_free_storage_days, co.offer_specs,
		          co.status, co.rejected_reason, co.cancel_reason, co.accepted_terms, co.created_at, co.updated_at,
		          l.side AS ref_side,
		          COALESCE(l.product_id, CASE co.mode WHEN 'buy' THEN s.buy_product_id ELSE s.sell_product_id END) AS product_id,
		          COALESCE(l.price, CASE co.mode WHEN 'buy' THEN s.buy_price ELSE s.sell_price END) AS ref_price,
		          COALESCE(l.created_at, s.created_at) AS ref_created_at,
		          COALESCE(l.serial_no, s.serial_no) AS ref_serial_no,
		          COALESCE(l.delivery_method, CASE co.mode WHEN 'buy' THEN s.buy_delivery_method ELSE s.sell_delivery_method END) AS ref_delivery_method,
		          COALESCE(l.free_storage_enabled, CASE co.mode WHEN 'buy' THEN s.buy_free_storage_enabled ELSE s.sell_free_storage_enabled END) AS ref_free_storage_enabled,
		          COALESCE(l.free_storage_days, CASE co.mode WHEN 'buy' THEN s.buy_free_storage_days ELSE s.sell_free_storage_days END) AS ref_free_storage_days,
		          COALESCE(l.delivery_period, CASE co.mode WHEN 'buy' THEN s.buy_delivery_period ELSE s.sell_delivery_period END) AS ref_delivery_period,
		          COALESCE(l.delivery_location, CASE co.mode WHEN 'buy' THEN s.buy_delivery_location ELSE s.sell_delivery_location END) AS ref_delivery_location,
		          COALESCE(l.payment_method, CASE co.mode WHEN 'buy' THEN s.buy_payment_method ELSE s.sell_payment_method END) AS ref_payment_method,
		          COALESCE(l.specs::text, CASE co.mode WHEN 'buy' THEN s.buy_specs::text ELSE s.sell_specs::text END) AS ref_specs,
		          COALESCE(l.quantity, CASE co.mode WHEN 'buy' THEN s.buy_quantity ELSE s.sell_quantity END) AS ref_quantity,
		          COALESCE(l.filled, CASE co.mode WHEN 'buy' THEN s.buy_filled ELSE s.sell_filled END) AS ref_filled
		   FROM counter_offers co LEFT JOIN listings l ON co.ref_type = 'listing' AND l.id = co.ref_id
		   LEFT JOIN swap_listings s ON co.ref_type = 'swap' AND s.id = co.ref_id WHERE ` + whereClause +
		` ORDER BY co.created_at DESC LIMIT $` + itoa(argIdx) + ` OFFSET $` + itoa(argIdx+1)
	dataArgs := append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, dataQuery, dataArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []CounterOffer
	for rows.Next() {
		var co CounterOffer
		if err := rows.Scan(&co.ID, &co.RefType, &co.RefID, &co.Mode, &co.NegotiationGroupID, &co.OfferUserID, &co.ListingUserID,
			&co.OfferPrice, &co.OfferQuantity,
			&co.OfferDeliveryPeriod, &co.OfferDeliveryLocation, &co.OfferPaymentMethod, &co.OfferDeliveryMethod,
			&co.OfferFreeStorageEnabled, &co.OfferFreeStorageDays, &co.OfferSpecs,
			&co.Status, &co.RejectedReason, &co.CancelReason, &co.AcceptedTerms, &co.CreatedAt, &co.UpdatedAt,
			&co.RefSide, &co.ProductID, &co.RefPrice, &co.RefCreatedAt, &co.RefSerialNo,
			&co.RefDeliveryMethod, &co.RefFreeStorageEnabled, &co.RefFreeStorageDays, &co.RefDeliveryPeriod, &co.RefDeliveryLocation, &co.RefPaymentMethod, &co.RefSpecs, &co.RefQuantity, &co.RefFilled); err != nil {
			return nil, err
		}
		results = append(results, co)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if results == nil {
		results = []CounterOffer{}
	}

	totalPage := (total + pageSize - 1) / pageSize
	return &CounterOfferPage{
		Data:      results,
		Total:     total,
		Page:      page,
		PageSize:  pageSize,
		TotalPage: totalPage,
	}, nil
}

// Accept 接受还价（将状态改为 ACCEPTED）
func (r *CounterOfferRepo) Accept(ctx context.Context, id uuid.UUID, listingUserID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE counter_offers SET status = 'ACCEPTED', updated_at = NOW()
		 WHERE id = $1 AND listing_user_id = $2 AND status = 'PENDING'`,
		id, listingUserID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Reject 拒绝还价
func (r *CounterOfferRepo) Reject(ctx context.Context, id uuid.UUID, listingUserID uuid.UUID, reason *string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE counter_offers SET status = 'REJECTED', rejected_reason = $3, updated_at = NOW()
		 WHERE id = $1 AND listing_user_id = $2 AND status = 'PENDING'`,
		id, listingUserID, reason)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CancelByOfferUser 议价方主动撤销自己的议价
func (r *CounterOfferRepo) CancelByOfferUser(ctx context.Context, id uuid.UUID, offerUserID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE counter_offers SET status = 'CANCELLED', updated_at = NOW()
		 WHERE id = $1 AND offer_user_id = $2 AND status = 'PENDING'`,
		id, offerUserID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// PartialAccept 挂牌方部分接受：将状态置为 PARTIAL_ACCEPTED 并记录接受的条款键
func (r *CounterOfferRepo) PartialAccept(ctx context.Context, id uuid.UUID, acceptedTerms json.RawMessage) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE counter_offers SET status = 'PARTIAL_ACCEPTED', accepted_terms = $2, updated_at = NOW()
		 WHERE id = $1 AND status = 'PENDING'`,
		id, acceptedTerms)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// MarkAccepted 标记还价为 ACCEPTED（不限前置状态，用于部分接受后二次确认成交）
func (r *CounterOfferRepo) MarkAccepted(ctx context.Context, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE counter_offers SET status = 'ACCEPTED', updated_at = NOW() WHERE id = $1`,
		id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// RejectPartial 发起方拒绝挂牌方的部分接受：置为 CANCELLED 并记录原因
func (r *CounterOfferRepo) RejectPartial(ctx context.Context, id uuid.UUID, offerUserID uuid.UUID, reason string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE counter_offers SET status = 'CANCELLED', cancel_reason = $3, updated_at = NOW()
		 WHERE id = $1 AND offer_user_id = $2 AND status = 'PARTIAL_ACCEPTED'`,
		id, offerUserID, reason)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ExpireOthers 将同一 ref 下其他 PENDING 议价标记为 CANCELLED（某条被接受成交后调用），撤销原因记为「已成交」
func (r *CounterOfferRepo) ExpireOthers(ctx context.Context, refType string, refID uuid.UUID, acceptedID uuid.UUID) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE counter_offers SET status = 'CANCELLED', cancel_reason = '已成交', updated_at = NOW()
		 WHERE ref_type = $1 AND ref_id = $2 AND status = 'PENDING' AND id != $3`,
		refType, refID, acceptedID)
	return err
}

// ExpirePending 将当天及之前创建的 PENDING 议价标记为 EXPIRED
func (r *CounterOfferRepo) ExpirePending(ctx context.Context) (int64, error) {
	tag, err := r.pool.Exec(ctx,
		`UPDATE counter_offers SET status = 'EXPIRED', updated_at = NOW()
		 WHERE status = 'PENDING' AND created_at < DATE_TRUNC('day', NOW())`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// AutoCancelPending 当关联挂牌/换盘被撤销或成交时，自动将 PENDING 议价置为 CANCELLED 并记录原因
// refType: "listing" 或 "swap"
// refID: 关联的挂牌/换盘 ID
// reason: 撤销原因，如 "对方已成交" 或 "对方已撤盘"
func (r *CounterOfferRepo) AutoCancelPending(ctx context.Context, refType string, refID uuid.UUID, reason string) (int64, error) {
	tag, err := r.pool.Exec(ctx,
		`UPDATE counter_offers SET status = 'CANCELLED', cancel_reason = $3, updated_at = NOW()
		 WHERE ref_type = $1 AND ref_id = $2 AND status = 'PENDING'`,
		refType, refID, reason)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// AutoCancelPendingTx 在事务内撤销关联的 PENDING 商谈。
// 用于撤盘事务中保证「撤盘 + 撤销商谈」原子性。
func (r *CounterOfferRepo) AutoCancelPendingTx(ctx context.Context, tx pgx.Tx, refType string, refID uuid.UUID, reason string) (int64, error) {
	tag, err := tx.Exec(ctx,
		`UPDATE counter_offers SET status = 'CANCELLED', cancel_reason = $3, updated_at = NOW()
		 WHERE ref_type = $1 AND ref_id = $2 AND status = 'PENDING'`,
		refType, refID, reason)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// Update 更新 PENDING 商谈的条款字段（仅 offer_user_id 可操作，仅 PENDING 可更新）
func (r *CounterOfferRepo) Update(ctx context.Context, id uuid.UUID, offerUserID uuid.UUID,
	offerPrice float64, offerQuantity float64,
	offerDeliveryPeriod *string, offerDeliveryLocation *string, offerPaymentMethod *string,
	offerDeliveryMethod *string, offerFreeStorageEnabled *bool, offerFreeStorageDays *int, offerSpecs *string,
) (*CounterOffer, error) {
	tag, err := r.pool.Exec(ctx,
		`UPDATE counter_offers SET
			offer_price = $3, offer_quantity = $4,
			offer_delivery_period = $5, offer_delivery_location = $6, offer_payment_method = $7,
			offer_delivery_method = $8, offer_free_storage_enabled = $9, offer_free_storage_days = $10, offer_specs = $11,
			updated_at = NOW()
		 WHERE id = $1 AND offer_user_id = $2 AND status = 'PENDING'`,
		id, offerUserID, offerPrice, offerQuantity,
		offerDeliveryPeriod, offerDeliveryLocation, offerPaymentMethod,
		offerDeliveryMethod, offerFreeStorageEnabled, offerFreeStorageDays, offerSpecs,
	)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	// 返回更新后的记录
	return r.FindByID(ctx, id)
}

// CountPendingByRef 统计某挂牌/换盘下 PENDING 商谈数量
func (r *CounterOfferRepo) CountPendingByRef(ctx context.Context, refType string, refID uuid.UUID) (int64, error) {
	var n int64
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM counter_offers WHERE ref_type = $1 AND ref_id = $2 AND status = 'PENDING'`,
		refType, refID,
	).Scan(&n)
	return n, err
}

// itoa 简易 int→string 转换（用于动态参数索引）
func itoa(i int) string {
	return strconv.Itoa(i)
}
