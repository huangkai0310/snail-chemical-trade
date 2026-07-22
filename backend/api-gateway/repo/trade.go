package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/calendar"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Trade struct {
	ID               uuid.UUID `json:"id"`
	SerialNo         int64     `json:"serial_no"` // 成交单号，前端展示为 T + 6 位补零
	ProductID        string    `json:"product_id"`
	BuyOrderID       uuid.UUID `json:"buy_order_id"`
	SellOrderID      uuid.UUID `json:"sell_order_id"`
	BuyUserID        uuid.UUID `json:"buy_user_id"`
	SellUserID       uuid.UUID `json:"sell_user_id"`
	Price            float64   `json:"price"`
	Quantity         float64   `json:"quantity"`
	Amount           float64   `json:"amount"`
	DeliveryPeriod   *string   `json:"delivery_period,omitempty"`
	DeliveryLocation *string   `json:"delivery_location,omitempty"`
	// 双边条款明细（每笔成交分别记录买卖双方的发盘信息）
	BuySerialNo       *int64         `json:"buy_serial_no,omitempty"`
	SellSerialNo      *int64         `json:"sell_serial_no,omitempty"`
	BuyPaymentMethod  *string        `json:"buy_payment_method,omitempty"`
	SellPaymentMethod *string        `json:"sell_payment_method,omitempty"`
	DeliveryMethod    *string        `json:"delivery_method,omitempty"`
	FreeStorageEnabled *bool         `json:"free_storage_enabled,omitempty"`
	FreeStorageDays   *int           `json:"free_storage_days,omitempty"`
	BuySpecs          json.RawMessage `json:"buy_specs,omitempty"`
	SellSpecs         json.RawMessage `json:"sell_specs,omitempty"`
	// 成交来源：auto=自动撮合, take=主动摘牌, counter_offer=议价成交,
	// swap=换盘市场成交（单买+单卖合成/三方，计入行情）,
	// swap_private=双方换盘撮合（仅发起方与同一接受方，不计入 K 线/最新价）
	Source          string     `json:"source"`
	AggressorUserID *uuid.UUID `json:"aggressor_user_id,omitempty"`
	TradedAt        time.Time  `json:"traded_at"`
	// NotifyListingUserID 仅 WS 推送用（不落库）：本笔涉及普通挂牌时的挂牌方
	NotifyListingUserID *uuid.UUID `json:"-"`
	// 仅「我的成交」等需展示对手身份时填充
	BuyCompanyName  *string `json:"buy_company_name,omitempty"`
	SellCompanyName *string `json:"sell_company_name,omitempty"`
	BuyUsername     *string `json:"buy_username,omitempty"`
	SellUsername    *string `json:"sell_username,omitempty"`
}

// 行情相关成交来源常量
const (
	TradeSourceSwap        = "swap"         // 计入行情
	TradeSourceSwapPrivate = "swap_private" // 双方换盘，不计入行情
)

// marketPriceSQL 行情聚合排除无市场参考意义的双方换盘成交
const marketPriceSQL = `source IS DISTINCT FROM 'swap_private'`

// spotPeriodSQL 现货合约：NULL / 空串 / 「现货」视为同一合约
const spotPeriodSQL = `(delivery_period IS NULL OR BTRIM(delivery_period) = '' OR delivery_period = '现货')`

// NormalizeDeliveryPeriod 行情合约键：空 → 现货（不同交割期互不混用）
func NormalizeDeliveryPeriod(period string) string {
	p := strings.TrimSpace(period)
	if p == "" {
		return "现货"
	}
	return p
}

// deliveryPeriodClause 按合约过滤。现货用等价条件；远期精确匹配。永不退回「全品种混期」。
func deliveryPeriodClause(period string, argStart int) (clause string, args []any) {
	p := NormalizeDeliveryPeriod(period)
	if p == "现货" {
		return spotPeriodSQL, nil
	}
	return fmt.Sprintf("delivery_period = $%d", argStart), []any{p}
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
		`INSERT INTO trades (product_id, buy_order_id, sell_order_id, buy_user_id, sell_user_id, price, quantity, delivery_period, delivery_location,
		                    buy_serial_no, sell_serial_no, buy_payment_method, sell_payment_method, delivery_method, free_storage_enabled, free_storage_days, buy_specs, sell_specs, source, aggressor_user_id)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
		 RETURNING id, serial_no, amount, traded_at`,
		t.ProductID, t.BuyOrderID, t.SellOrderID, t.BuyUserID, t.SellUserID, t.Price, t.Quantity, t.DeliveryPeriod, t.DeliveryLocation,
		t.BuySerialNo, t.SellSerialNo, t.BuyPaymentMethod, t.SellPaymentMethod, t.DeliveryMethod, t.FreeStorageEnabled, t.FreeStorageDays, t.BuySpecs, t.SellSpecs, t.Source, t.AggressorUserID,
	).Scan(&t.ID, &t.SerialNo, &t.Amount, &t.TradedAt)
}

// CreateTx 在事务内记录成交
func (r *TradeRepo) CreateTx(ctx context.Context, tx pgx.Tx, t *Trade) error {
	return tx.QueryRow(ctx,
		`INSERT INTO trades (product_id, buy_order_id, sell_order_id, buy_user_id, sell_user_id, price, quantity, delivery_period, delivery_location,
		                    buy_serial_no, sell_serial_no, buy_payment_method, sell_payment_method, delivery_method, free_storage_enabled, free_storage_days, buy_specs, sell_specs, source, aggressor_user_id)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
		 RETURNING id, serial_no, amount, traded_at`,
		t.ProductID, t.BuyOrderID, t.SellOrderID, t.BuyUserID, t.SellUserID, t.Price, t.Quantity, t.DeliveryPeriod, t.DeliveryLocation,
		t.BuySerialNo, t.SellSerialNo, t.BuyPaymentMethod, t.SellPaymentMethod, t.DeliveryMethod, t.FreeStorageEnabled, t.FreeStorageDays, t.BuySpecs, t.SellSpecs, t.Source, t.AggressorUserID,
	).Scan(&t.ID, &t.SerialNo, &t.Amount, &t.TradedAt)
}

// ListRecent 最近成交记录
func (r *TradeRepo) ListRecent(ctx context.Context, limit int) ([]Trade, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, serial_no, product_id, buy_order_id, sell_order_id, buy_user_id, sell_user_id,
		        price, quantity, amount, delivery_period, delivery_location, traded_at,
		        buy_serial_no, sell_serial_no, buy_payment_method, sell_payment_method, delivery_method, free_storage_enabled, free_storage_days, buy_specs, sell_specs, source, aggressor_user_id
		 FROM trades WHERE `+marketPriceSQL+`
		 ORDER BY traded_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trades []Trade
	for rows.Next() {
		var t Trade
		if err := rows.Scan(&t.ID, &t.SerialNo, &t.ProductID, &t.BuyOrderID, &t.SellOrderID,
			&t.BuyUserID, &t.SellUserID, &t.Price, &t.Quantity, &t.Amount,
			&t.DeliveryPeriod, &t.DeliveryLocation, &t.TradedAt, &t.BuySerialNo, &t.SellSerialNo, &t.BuyPaymentMethod, &t.SellPaymentMethod, &t.DeliveryMethod, &t.FreeStorageEnabled, &t.FreeStorageDays, &t.BuySpecs, &t.SellSpecs, &t.Source, &t.AggressorUserID); err != nil {
			return nil, err
		}
		trades = append(trades, t)
	}
	return trades, rows.Err()
}

// ListByUser 查询与某用户相关的成交（作为买方或卖方），附带买卖双方公司名
func (r *TradeRepo) ListByUser(ctx context.Context, userID uuid.UUID, limit int) ([]Trade, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := r.pool.Query(ctx,
		`SELECT t.id, t.serial_no, t.product_id, t.buy_order_id, t.sell_order_id, t.buy_user_id, t.sell_user_id,
		        t.price, t.quantity, t.amount, t.delivery_period, t.delivery_location, t.traded_at,
		        t.buy_serial_no, t.sell_serial_no, t.buy_payment_method, t.sell_payment_method,
		        t.delivery_method, t.free_storage_enabled, t.free_storage_days, t.buy_specs, t.sell_specs,
		        t.source, t.aggressor_user_id,
		        bu.company_name, su.company_name, bu.username, su.username
		 FROM trades t
		 LEFT JOIN users bu ON bu.id = t.buy_user_id
		 LEFT JOIN users su ON su.id = t.sell_user_id
		 WHERE t.buy_user_id = $1 OR t.sell_user_id = $1
		 ORDER BY t.traded_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trades []Trade
	for rows.Next() {
		var t Trade
		if err := rows.Scan(&t.ID, &t.SerialNo, &t.ProductID, &t.BuyOrderID, &t.SellOrderID,
			&t.BuyUserID, &t.SellUserID, &t.Price, &t.Quantity, &t.Amount,
			&t.DeliveryPeriod, &t.DeliveryLocation, &t.TradedAt, &t.BuySerialNo, &t.SellSerialNo,
			&t.BuyPaymentMethod, &t.SellPaymentMethod, &t.DeliveryMethod, &t.FreeStorageEnabled,
			&t.FreeStorageDays, &t.BuySpecs, &t.SellSpecs, &t.Source, &t.AggressorUserID,
			&t.BuyCompanyName, &t.SellCompanyName, &t.BuyUsername, &t.SellUsername); err != nil {
			return nil, err
		}
		trades = append(trades, t)
	}
	return trades, rows.Err()
}
func (r *TradeRepo) ListByProduct(ctx context.Context, productID string, limit int, deliveryPeriod string) ([]Trade, error) {
	if limit <= 0 {
		limit = 20
	}
	periodClause, periodArgs := deliveryPeriodClause(deliveryPeriod, 2)
	args := []any{productID}
	args = append(args, periodArgs...)
	limitIdx := len(args) + 1
	args = append(args, limit)

	rows, err := r.pool.Query(ctx,
		`SELECT id, serial_no, product_id, buy_order_id, sell_order_id, buy_user_id, sell_user_id,
		        price, quantity, amount, delivery_period, delivery_location, traded_at,
	        buy_serial_no, sell_serial_no, buy_payment_method, sell_payment_method, delivery_method, free_storage_enabled, free_storage_days, buy_specs, sell_specs, source, aggressor_user_id
		 FROM trades WHERE product_id = $1 AND `+periodClause+` AND `+marketPriceSQL+`
		 ORDER BY traded_at DESC LIMIT $`+fmt.Sprintf("%d", limitIdx), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trades []Trade
	for rows.Next() {
		var t Trade
		if err := rows.Scan(&t.ID, &t.SerialNo, &t.ProductID, &t.BuyOrderID, &t.SellOrderID,
			&t.BuyUserID, &t.SellUserID, &t.Price, &t.Quantity, &t.Amount,
			&t.DeliveryPeriod, &t.DeliveryLocation, &t.TradedAt, &t.BuySerialNo, &t.SellSerialNo, &t.BuyPaymentMethod, &t.SellPaymentMethod, &t.DeliveryMethod, &t.FreeStorageEnabled, &t.FreeStorageDays, &t.BuySpecs, &t.SellSpecs, &t.Source, &t.AggressorUserID); err != nil {
			return nil, err
		}
		trades = append(trades, t)
	}
	return trades, rows.Err()
}

// PriceCandle 价格K线/折线数据点
type PriceCandle struct {
	Time     time.Time `json:"time"`
	Open     float64   `json:"open"`
	High     float64   `json:"high"`
	Low      float64   `json:"low"`
	Close    float64   `json:"close"`
	Volume   float64   `json:"volume"`
	Turnover float64   `json:"turnover"` // 成交额 = SUM(amount)
}

// GetPriceHistory 查询价格走势（以分钟/小时为粒度的OHLCV）
// interval: '1 minute' | '5 minutes' | '15 minutes' | '30 minutes' | '1 hour' | '2 hours' | '4 hours' | '1 day' | '1 week' | '1 month'
func (r *TradeRepo) GetPriceHistory(ctx context.Context, productID string, interval string, limit int, deliveryPeriod string) ([]PriceCandle, error) {
	if limit <= 0 {
		limit = 60
	}
	// 有效interval白名单，防止注入
	validIntervals := map[string]bool{
		"1 minute": true, "5 minutes": true, "15 minutes": true, "30 minutes": true,
		"1 hour": true, "2 hours": true, "4 hours": true,
		"1 day": true, "1 week": true, "1 month": true, "3 months": true, "1 year": true,
	}
	if !validIntervals[interval] {
		interval = "1 hour"
	}

	// 使用 to_timestamp(floor(extract(epoch from traded_at) / seconds) * seconds) 按固定时间窗口分组
	// 将 interval 转换为秒数
	intervalSeconds := map[string]int{
		"1 minute": 60, "5 minutes": 300, "15 minutes": 900, "30 minutes": 1800,
		"1 hour": 3600, "2 hours": 7200, "4 hours": 14400,
		"1 day": 86400, "1 week": 604800, "1 month": 2592000, "3 months": 7776000, "1 year": 31536000,
	}
	secs := intervalSeconds[interval]

	// 日线按 Asia/Shanghai 自然日切分（24:00 收盘），与昨结口径一致；其余周期仍按固定秒窗口
	var rows pgx.Rows
	var err error
	if interval == "1 day" {
		periodClause, periodArgs := deliveryPeriodClause(deliveryPeriod, 2)
		args := []any{productID}
		args = append(args, periodArgs...)
		limitIdx := len(args) + 1
		args = append(args, limit)
		rows, err = r.pool.Query(ctx,
			`SELECT
			    (date_trunc('day', traded_at AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') AS bucket,
			    (array_agg(price ORDER BY traded_at ASC))[1] AS open,
			    MAX(price) AS high,
			    MIN(price) AS low,
			    (array_agg(price ORDER BY traded_at DESC))[1] AS close,
			    SUM(quantity) AS volume,
			    SUM(amount) AS turnover
			 FROM trades
			 WHERE product_id = $1 AND `+periodClause+` AND `+marketPriceSQL+`
			   AND traded_at >= (date_trunc('day', NOW() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')
			                - (($`+fmt.Sprintf("%d", limitIdx)+`::int) * INTERVAL '1 day')
			 GROUP BY bucket
			 ORDER BY bucket ASC`, args...)
	} else {
		periodClause, periodArgs := deliveryPeriodClause(deliveryPeriod, 3)
		args := []any{secs, productID}
		args = append(args, periodArgs...)
		limitIdx := len(args) + 1
		args = append(args, limit)
		rows, err = r.pool.Query(ctx,
			`SELECT
			    to_timestamp(floor(extract(epoch from traded_at) / $1) * $1) AS bucket,
			    (array_agg(price ORDER BY traded_at ASC))[1] AS open,
			    MAX(price) AS high,
			    MIN(price) AS low,
			    (array_agg(price ORDER BY traded_at DESC))[1] AS close,
			    SUM(quantity) AS volume,
			    SUM(amount) AS turnover
			 FROM trades
			 WHERE product_id = $2 AND `+periodClause+` AND `+marketPriceSQL+`
			   AND traded_at >= NOW() - ($`+fmt.Sprintf("%d", limitIdx)+` * ($1 || ' seconds')::interval)
			 GROUP BY bucket
			 ORDER BY bucket ASC`, args...)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var candles []PriceCandle
	for rows.Next() {
		var c PriceCandle
		if err := rows.Scan(&c.Time, &c.Open, &c.High, &c.Low, &c.Close, &c.Volume, &c.Turnover); err != nil {
			return nil, err
		}
		candles = append(candles, c)
	}
	return candles, rows.Err()
}

// GetLatestPrice 获取某合约最新成交价及涨跌基准。
// 24 小时滚动交易；每日 24:00（Asia/Shanghai）为收盘时点：
// 昨结 = 上一工作日行情成交的成交量加权均价 VWAP。
// 工作日 = 周一至周五，扣除国务院法定放假日，计入调休上班日。
func (r *TradeRepo) GetLatestPrice(ctx context.Context, productID string, deliveryPeriod string) (latest float64, prevSettle float64, volumeToday float64, err error) {
	periodClause, periodArgs := deliveryPeriodClause(deliveryPeriod, 2)
	args := []any{productID}
	args = append(args, periodArgs...)

	todayStart := calendar.DayStart(time.Now())
	prevStart := calendar.PrevWorkdayStart(todayStart)
	prevEnd := prevStart.AddDate(0, 0, 1)

	base := 2 + len(periodArgs)
	todayP := "$" + strconv.Itoa(base)
	prevStartP := "$" + strconv.Itoa(base+1)
	prevEndP := "$" + strconv.Itoa(base+2)
	args = append(args, todayStart, prevStart, prevEnd)

	err = r.pool.QueryRow(ctx,
		`SELECT
		   COALESCE((
		     SELECT price FROM trades
		     WHERE product_id = $1 AND `+periodClause+` AND `+marketPriceSQL+`
		     ORDER BY traded_at DESC LIMIT 1
		   ), 0),
		   COALESCE((
		     SELECT CASE WHEN SUM(quantity) > 0
		       THEN SUM(price * quantity) / SUM(quantity)
		       ELSE 0 END
		     FROM trades
		     WHERE product_id = $1 AND `+periodClause+` AND `+marketPriceSQL+`
		       AND traded_at >= `+prevStartP+`
		       AND traded_at <  `+prevEndP+`
		   ), 0),
		   COALESCE((
		     SELECT SUM(quantity) FROM trades
		     WHERE product_id = $1 AND `+periodClause+` AND `+marketPriceSQL+`
		       AND traded_at >= `+todayP+`
		   ), 0)
		`, args...).Scan(&latest, &prevSettle, &volumeToday)
	return
}
