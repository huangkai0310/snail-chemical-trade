package repo

import (
	"bytes"
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ListingStatus string

const (
	ListingOpen      ListingStatus = "OPEN"
	ListingPartial   ListingStatus = "PARTIAL"
	ListingFilled    ListingStatus = "FILLED"
	ListingCancelled ListingStatus = "CANCELLED"
	ListingExpired   ListingStatus = "EXPIRED"
	ListingScheduled ListingStatus = "SCHEDULED"
)

type Listing struct {
	ID                uuid.UUID       `json:"id"`
	SerialNo          int64           `json:"serial_no"` // 唯一自增序号，供前端展示和搜索
	UserID            uuid.UUID       `json:"user_id"`
	ProductID         string          `json:"product_id"`
	Side              string          `json:"side"`
	Price             float64         `json:"price"`
	Quantity          float64         `json:"quantity"`
	Filled            float64         `json:"filled"`
	Status            ListingStatus   `json:"status"`
	AllowPartial      bool            `json:"allow_partial"`
	AllowCounterOffer bool            `json:"allow_counter_offer"` // 是否允许议价（默认 true 可议价）
	NegotiableTerms   json.RawMessage `json:"negotiable_terms,omitempty"` // 可议条款范围（价格/数量/交割期/地/付款/交割方式/免仓/规格），空=不可议
	MinQuantity       float64         `json:"min_quantity"` // 最小成交量（可拆单时生效，0=无限制）
	DeliveryPeriod    *string         `json:"delivery_period,omitempty"`
	DeliveryLocation  *string         `json:"delivery_location,omitempty"`
	PaymentMethod     *string         `json:"payment_method,omitempty"` // 付款方式：款到发货/货到付款/预收保证金(10%)/见票付款/账期结算
	DeliveryMethod    *string         `json:"delivery_method,omitempty"`     // 交割方式：混罐货转/货转/自提/送到，支持自定义
	FreeStorageEnabled bool           `json:"free_storage_enabled"`          // 是否可免仓（默认 true）
	FreeStorageDays   *int            `json:"free_storage_days,omitempty"`   // 免仓天数（可免仓时生效，如 7/3）
	Specs             json.RawMessage `json:"specs,omitempty"`
	Remark            *string         `json:"remark,omitempty"`
	ExpiresAt         *time.Time      `json:"expires_at,omitempty"` // 过期时间（默认当日 18:00）
	StartsAt          *time.Time      `json:"starts_at,omitempty"`  // 计划开始时间；空=立即；未来=SCHEDULED
	// Origin: post=主动发盘（默认）；take=摘盘对向单，不展示在盘面/我的挂盘
	Origin            string          `json:"origin,omitempty"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

// MarshalJSON 自定义序列化：当 Specs 为空对象 {} 时输出 null，避免前端 React Error #31
func (l Listing) MarshalJSON() ([]byte, error) {
	type Alias Listing
	if len(l.Specs) > 0 {
		trimmed := bytes.TrimSpace(l.Specs)
		if string(trimmed) == "{}" || string(trimmed) == "null" {
			l.Specs = nil
		}
	}
	return json.Marshal((Alias)(l))
}

type ListingRepo struct {
	pool *pgxpool.Pool
}

func NewListingRepo(pool *pgxpool.Pool) *ListingRepo {
	return &ListingRepo{pool: pool}
}

// Create 创建挂牌单
func (r *ListingRepo) Create(ctx context.Context, l *Listing) error {
	status := string(l.Status)
	if status == "" {
		status = string(ListingOpen)
	}
	origin := l.Origin
	if origin == "" {
		origin = "post"
	}
	nt := l.NegotiableTerms
	if len(nt) == 0 || !json.Valid(nt) || string(bytes.TrimSpace(nt)) == "null" {
		nt = json.RawMessage(`[]`)
	}
	return r.pool.QueryRow(ctx,
		`INSERT INTO listings (user_id, product_id, side, price, quantity, min_quantity, delivery_period, delivery_location, payment_method, delivery_method, free_storage_enabled, free_storage_days, specs, remark, status, allow_partial, allow_counter_offer, negotiable_terms, expires_at, starts_at, origin)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
		 RETURNING id, serial_no, filled, status, allow_partial, allow_counter_offer, expires_at, starts_at, origin, created_at, updated_at`,
		l.UserID, l.ProductID, l.Side, l.Price, l.Quantity, l.MinQuantity,
		l.DeliveryPeriod, l.DeliveryLocation, l.PaymentMethod, l.DeliveryMethod, l.FreeStorageEnabled, l.FreeStorageDays, l.Specs, l.Remark, status,
		l.AllowPartial, l.AllowCounterOffer, nt, l.ExpiresAt, l.StartsAt, origin,
	).Scan(&l.ID, &l.SerialNo, &l.Filled, &l.Status, &l.AllowPartial, &l.AllowCounterOffer, &l.ExpiresAt, &l.StartsAt, &l.Origin, &l.CreatedAt, &l.UpdatedAt)
}

// ListByProduct 查询某品种的活跃挂牌
func (r *ListingRepo) ListByProduct(ctx context.Context, productID string) ([]Listing, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, serial_no, user_id, product_id, side, price, quantity, filled, status, allow_partial, allow_counter_offer, negotiable_terms, min_quantity,
		        delivery_period, delivery_location, payment_method, delivery_method, free_storage_enabled, free_storage_days, specs, remark, expires_at, starts_at, created_at, updated_at
		 FROM listings
		 WHERE product_id = $1 AND status IN ('OPEN','PARTIAL')
		   AND COALESCE(origin, 'post') <> 'take'
		   AND (expires_at IS NULL OR expires_at > NOW())
		 ORDER BY created_at DESC LIMIT 100`, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var listings []Listing
	for rows.Next() {
		var l Listing
		if err := rows.Scan(&l.ID, &l.SerialNo, &l.UserID, &l.ProductID, &l.Side, &l.Price, &l.Quantity,
			&l.Filled, &l.Status, &l.AllowPartial, &l.AllowCounterOffer, &l.NegotiableTerms, &l.MinQuantity, &l.DeliveryPeriod, &l.DeliveryLocation, &l.PaymentMethod, &l.DeliveryMethod, &l.FreeStorageEnabled, &l.FreeStorageDays, &l.Specs, &l.Remark,
			&l.ExpiresAt, &l.StartsAt, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, err
		}
		listings = append(listings, l)
	}
	return listings, rows.Err()
}

// ListFilter 挂牌列表筛选参数
type ListFilter struct {
	ProductID      string
	Side           string // "BUY" | "SELL" | ""
	Status         string // "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED" | ""
	DeliveryPeriod string
	SerialNo       int64  // 按 serial_no 精确查询（前端按序号搜索）
	// ExcludeUserIDs 排除这些用户的发盘（黑名单互不可见），同时作用于 COUNT 与分页
	ExcludeUserIDs []uuid.UUID
	// IncludeScheduledUserID 若非 Nil，将该用户自己的 SCHEDULED 盘并入默认列表
	IncludeScheduledUserID uuid.UUID
	Offset         int
	Limit          int
}

// ListFiltered 带筛选和分页的挂牌列表查询
func (r *ListingRepo) ListFiltered(ctx context.Context, f ListFilter) ([]Listing, int, error) {
	if f.Limit <= 0 {
		f.Limit = 20
	}
	if f.Offset < 0 {
		f.Offset = 0
	}

	// 动态构建 WHERE 条件
	where := "WHERE 1=1"
	args := []interface{}{}
	argIdx := 1

	// #304：serial_no 精确查询优先，忽略其他过滤条件
	if f.SerialNo > 0 {
		where += " AND serial_no = $" + strconv.Itoa(argIdx)
		args = append(args, f.SerialNo)
		argIdx++
	} else {
		// 摘盘对向单不进入盘面发盘列表（无论状态筛选）
		where += " AND COALESCE(origin, 'post') <> 'take'"
		if f.ProductID != "" {
			where += " AND product_id = $" + strconv.Itoa(argIdx)
			args = append(args, f.ProductID)
			argIdx++
		}
		if f.Side != "" {
			where += " AND side = $" + strconv.Itoa(argIdx)
			args = append(args, f.Side)
			argIdx++
		}
		if f.Status != "" {
			where += " AND status = $" + strconv.Itoa(argIdx)
			args = append(args, f.Status)
			argIdx++
		} else {
			// 默认展示挂牌中和已成交；活跃盘过滤已过期；自己的待发布盘可见
			if f.IncludeScheduledUserID != uuid.Nil {
				where += " AND (status = 'FILLED' OR (status IN ('OPEN','PARTIAL') AND (expires_at IS NULL OR expires_at > NOW())) OR (status = 'SCHEDULED' AND user_id = $" + strconv.Itoa(argIdx) + "))"
				args = append(args, f.IncludeScheduledUserID)
				argIdx++
			} else {
				where += " AND (status = 'FILLED' OR (status IN ('OPEN','PARTIAL') AND (expires_at IS NULL OR expires_at > NOW())))"
			}
		}
		if f.DeliveryPeriod != "" {
			where += " AND delivery_period = $" + strconv.Itoa(argIdx)
			args = append(args, f.DeliveryPeriod)
			argIdx++
		}
	}

	if len(f.ExcludeUserIDs) > 0 {
		where += " AND user_id <> ALL($" + strconv.Itoa(argIdx) + ")"
		args = append(args, f.ExcludeUserIDs)
		argIdx++
	}

	// 先查总数（与列表同条件，含隐藏用户排除）
	var total int
	countQuery := "SELECT COUNT(*) FROM listings " + where
	if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// 分页查询
	query := `SELECT id, serial_no, user_id, product_id, side, price, quantity, filled, status, allow_partial, allow_counter_offer, negotiable_terms, min_quantity,
		        delivery_period, delivery_location, payment_method, delivery_method, free_storage_enabled, free_storage_days, specs, remark, expires_at, starts_at, created_at, updated_at
		 FROM listings ` + where +
		" ORDER BY created_at DESC LIMIT $" + strconv.Itoa(argIdx) + " OFFSET $" + strconv.Itoa(argIdx+1)
	args = append(args, f.Limit, f.Offset)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var listings []Listing
	for rows.Next() {
		var l Listing
		if err := rows.Scan(&l.ID, &l.SerialNo, &l.UserID, &l.ProductID, &l.Side, &l.Price, &l.Quantity,
			&l.Filled, &l.Status, &l.AllowPartial, &l.AllowCounterOffer, &l.NegotiableTerms, &l.MinQuantity, &l.DeliveryPeriod, &l.DeliveryLocation, &l.PaymentMethod, &l.DeliveryMethod, &l.FreeStorageEnabled, &l.FreeStorageDays, &l.Specs, &l.Remark,
			&l.ExpiresAt, &l.StartsAt, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, 0, err
		}
		listings = append(listings, l)
	}
	return listings, total, rows.Err()
}


// FindByID 按 ID 查挂牌
func (r *ListingRepo) FindByID(ctx context.Context, id uuid.UUID) (*Listing, error) {
	l := &Listing{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, serial_no, user_id, product_id, side, price, quantity, filled, status, allow_partial, allow_counter_offer, negotiable_terms, min_quantity,
		        delivery_period, delivery_location, payment_method, delivery_method, free_storage_enabled, free_storage_days, specs, remark, expires_at, starts_at, created_at, updated_at
		 FROM listings WHERE id = $1`, id,
	).Scan(&l.ID, &l.SerialNo, &l.UserID, &l.ProductID, &l.Side, &l.Price, &l.Quantity,
		&l.Filled, &l.Status, &l.AllowPartial, &l.AllowCounterOffer, &l.NegotiableTerms, &l.MinQuantity, &l.DeliveryPeriod, &l.DeliveryLocation, &l.PaymentMethod, &l.DeliveryMethod, &l.FreeStorageEnabled, &l.FreeStorageDays, &l.Specs, &l.Remark,
		&l.ExpiresAt, &l.StartsAt, &l.CreatedAt, &l.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return l, nil
}

// Update 编辑挂牌可修改字段（仅 OPEN/PARTIAL 状态可编辑，不可改 product_id/side/filled/status）
func (r *ListingRepo) Update(ctx context.Context, l *Listing) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE listings SET
		    price = $2,
		    quantity = $3,
		    min_quantity = $4,
		    delivery_period = $5,
		    delivery_location = $6,
		    payment_method = $7,
		    delivery_method = $8,
		    free_storage_enabled = $9,
		    free_storage_days = $10,
		    specs = $11,
		    remark = $12,
		    allow_partial = $13,
		    allow_counter_offer = $14,
		    negotiable_terms = $15,
		    expires_at = $16,
		    starts_at = $17,
		    status = $18,
		    expire_reminded_at = CASE
		      WHEN expires_at IS DISTINCT FROM $16 THEN NULL
		      ELSE expire_reminded_at
		    END,
		    start_reminded_at = CASE
		      WHEN starts_at IS DISTINCT FROM $17 THEN NULL
		      ELSE start_reminded_at
		    END,
		    updated_at = NOW()
		 WHERE id = $1 AND user_id = $19 AND status IN ('OPEN','PARTIAL','SCHEDULED')`,
		l.ID, l.Price, l.Quantity, l.MinQuantity,
		l.DeliveryPeriod, l.DeliveryLocation, l.PaymentMethod, l.DeliveryMethod,
		l.FreeStorageEnabled, l.FreeStorageDays, l.Specs, l.Remark,
		l.AllowPartial, l.AllowCounterOffer, l.NegotiableTerms, l.ExpiresAt, l.StartsAt, string(l.Status),
		l.UserID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Cancel 撤牌
func (r *ListingRepo) Cancel(ctx context.Context, id uuid.UUID, userID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE listings SET status = 'CANCELLED', updated_at = NOW()
		 WHERE id = $1 AND user_id = $2 AND status IN ('OPEN','PARTIAL','SCHEDULED')`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CancelTx 在事务内撤销挂牌。调用方需先通过 SELECT FOR UPDATE 锁住行。
// 返回 ErrNotFound 表示状态已不再是 OPEN/PARTIAL/SCHEDULED（可能已被成交/撤盘）。
func (r *ListingRepo) CancelTx(ctx context.Context, tx pgx.Tx, id uuid.UUID, userID uuid.UUID) error {
	tag, err := tx.Exec(ctx,
		`UPDATE listings SET status = 'CANCELLED', updated_at = NOW()
		 WHERE id = $1 AND user_id = $2 AND status IN ('OPEN','PARTIAL','SCHEDULED')`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// LockByIDTx 在事务内对指定挂牌加行锁（SELECT FOR UPDATE），防止并发修改。
// 调用方应在事务中先调用此方法锁住目标行，再执行后续更新。
func (r *ListingRepo) LockByIDTx(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*Listing, error) {
	l := &Listing{}
	var dp, dl, pm, dm, rm *string
	var fsd *int
	var specs json.RawMessage
	var nt json.RawMessage
	err := tx.QueryRow(ctx,
		`SELECT id, serial_no, user_id, product_id, side, price, quantity, filled, status, allow_partial, allow_counter_offer, negotiable_terms, min_quantity,
		        delivery_period, delivery_location, payment_method, delivery_method, free_storage_enabled, free_storage_days, specs, remark, expires_at, starts_at, created_at, updated_at
		 FROM listings WHERE id = $1 FOR UPDATE`, id).Scan(
		&l.ID, &l.SerialNo, &l.UserID, &l.ProductID, &l.Side, &l.Price, &l.Quantity, &l.Filled, &l.Status,
		&l.AllowPartial, &l.AllowCounterOffer, &nt, &l.MinQuantity,
		&dp, &dl, &pm, &dm, &l.FreeStorageEnabled, &fsd, &specs, &rm, &l.ExpiresAt, &l.StartsAt, &l.CreatedAt, &l.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	l.DeliveryPeriod = dp
	l.DeliveryLocation = dl
	l.PaymentMethod = pm
	l.DeliveryMethod = dm
	l.FreeStorageDays = fsd
	l.Specs = specs
	l.NegotiableTerms = nt
	l.Remark = rm
	return l, nil
}

// GetUserID 获取挂牌对应的用户 ID
func (r *ListingRepo) GetUserID(ctx context.Context, id uuid.UUID) (uuid.UUID, error) {
	var userID uuid.UUID
	err := r.pool.QueryRow(ctx, `SELECT user_id FROM listings WHERE id = $1`, id).Scan(&userID)
	return userID, err
}

// ListActive 查询所有可撮合的挂牌（启动时恢复订单簿）
func (r *ListingRepo) ListActive(ctx context.Context) ([]Listing, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, serial_no, user_id, product_id, side, price, quantity, filled, status, allow_partial, allow_counter_offer, negotiable_terms, min_quantity,
		        delivery_period, delivery_location, payment_method, delivery_method, free_storage_enabled, free_storage_days, specs, remark, expires_at, starts_at, created_at, updated_at
		 FROM listings
		 WHERE status IN ('OPEN','PARTIAL')
		   AND COALESCE(origin, 'post') <> 'take'
		   AND (expires_at IS NULL OR expires_at > NOW())
		 ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var listings []Listing
	for rows.Next() {
		var l Listing
		if err := rows.Scan(&l.ID, &l.SerialNo, &l.UserID, &l.ProductID, &l.Side, &l.Price, &l.Quantity,
			&l.Filled, &l.Status, &l.AllowPartial, &l.AllowCounterOffer, &l.NegotiableTerms, &l.MinQuantity, &l.DeliveryPeriod, &l.DeliveryLocation, &l.PaymentMethod, &l.DeliveryMethod, &l.FreeStorageEnabled, &l.FreeStorageDays, &l.Specs, &l.Remark,
			&l.ExpiresAt, &l.StartsAt, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, err
		}
		listings = append(listings, l)
	}
	return listings, rows.Err()
}

// ListByUser 查询某用户的所有挂牌（含历史），最新在前
func (r *ListingRepo) ListByUser(ctx context.Context, userID uuid.UUID, limit int) ([]Listing, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, serial_no, user_id, product_id, side, price, quantity, filled, status, allow_partial, allow_counter_offer, negotiable_terms, min_quantity,
		        delivery_period, delivery_location, payment_method, delivery_method, free_storage_enabled, free_storage_days, specs, remark, expires_at, starts_at, created_at, updated_at
		 FROM listings
		 WHERE user_id = $1 AND COALESCE(origin, 'post') <> 'take'
		 ORDER BY created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var listings []Listing
	for rows.Next() {
		var l Listing
		if err := rows.Scan(&l.ID, &l.SerialNo, &l.UserID, &l.ProductID, &l.Side, &l.Price, &l.Quantity,
			&l.Filled, &l.Status, &l.AllowPartial, &l.AllowCounterOffer, &l.NegotiableTerms, &l.MinQuantity, &l.DeliveryPeriod, &l.DeliveryLocation, &l.PaymentMethod, &l.DeliveryMethod, &l.FreeStorageEnabled, &l.FreeStorageDays, &l.Specs, &l.Remark,
			&l.ExpiresAt, &l.StartsAt, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, err
		}
		listings = append(listings, l)
	}
	return listings, rows.Err()
}
func (r *ListingRepo) AddFilled(ctx context.Context, id uuid.UUID, delta float64) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE listings SET
		    filled = filled + $2,
		    status = CASE
		        WHEN filled + $2 >= quantity THEN 'FILLED'
		        WHEN filled + $2 > 0 THEN 'PARTIAL'
		        ELSE status
		    END,
		    updated_at = NOW()
		 WHERE id = $1`, id, delta)
	return err
}

// AddFilledTx 在事务内累加已成交量。
// WHERE 加状态检查：仅 OPEN/PARTIAL 状态的挂牌才能累加成交量。
// 如果挂牌已被撤盘（CANCELLED）或已过期（EXPIRED），RowsAffected=0 返回 ErrNotFound，
// 防止撤盘后被成交覆盖（竞态保护）。
func (r *ListingRepo) AddFilledTx(ctx context.Context, tx pgx.Tx, id uuid.UUID, delta float64) error {
	tag, err := tx.Exec(ctx,
		`UPDATE listings SET
		    filled = filled + $2,
		    status = CASE
		        WHEN filled + $2 >= quantity THEN 'FILLED'
		        WHEN filled + $2 > 0 THEN 'PARTIAL'
		        ELSE status
		    END,
		    updated_at = NOW()
		 WHERE id = $1 AND status IN ('OPEN','PARTIAL')`, id, delta)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateFilled 设置已成交量和状态（摘牌/挂单后同步引擎结果）
func (r *ListingRepo) UpdateFilled(ctx context.Context, id uuid.UUID, filled float64, status ListingStatus) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE listings SET filled = $2, status = $3, updated_at = NOW() WHERE id = $1`,
		id, filled, status)
	return err
}

// UpdateFilledTx 在事务内设置已成交量和状态
func (r *ListingRepo) UpdateFilledTx(ctx context.Context, tx pgx.Tx, id uuid.UUID, filled float64, status ListingStatus) error {
	_, err := tx.Exec(ctx,
		`UPDATE listings SET filled = $2, status = $3, updated_at = NOW() WHERE id = $1`,
		id, filled, status)
	return err
}

// BeginTx 开启事务（方便 handler 直接使用 pool）
func (r *ListingRepo) BeginTx(ctx context.Context) (pgx.Tx, error) {
	return r.pool.Begin(ctx)
}

// ExpiredListing 过期清理返回项（用于从撮合引擎移除并推送）
type ExpiredListing struct {
	ID        uuid.UUID
	ProductID string
	UserID    uuid.UUID
}

// ExpireOutdated 将已到 expires_at 的 OPEN/PARTIAL 挂牌标记为 EXPIRED
func (r *ListingRepo) ExpireOutdated(ctx context.Context) ([]ExpiredListing, error) {
	rows, err := r.pool.Query(ctx,
		`UPDATE listings
		 SET status = 'EXPIRED', updated_at = NOW()
		 WHERE status IN ('OPEN', 'PARTIAL')
		   AND (filled = 0 OR filled < quantity)
		   AND (
		     (expires_at IS NOT NULL AND expires_at <= NOW())
		     OR (expires_at IS NULL AND created_at < (date_trunc('day', NOW() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'))
		   )
		 RETURNING id, product_id, user_id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ExpiredListing
	for rows.Next() {
		var e ExpiredListing
		if err := rows.Scan(&e.ID, &e.ProductID, &e.UserID); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ActivateScheduled 将已到 starts_at 的 SCHEDULED 挂牌改为 OPEN
func (r *ListingRepo) ActivateScheduled(ctx context.Context) ([]ExpiredListing, error) {
	rows, err := r.pool.Query(ctx,
		`UPDATE listings
		 SET status = 'OPEN', updated_at = NOW()
		 WHERE status = 'SCHEDULED'
		   AND starts_at IS NOT NULL
		   AND starts_at <= NOW()
		 RETURNING id, product_id, user_id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ExpiredListing
	for rows.Next() {
		var e ExpiredListing
		if err := rows.Scan(&e.ID, &e.ProductID, &e.UserID); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
