package repo

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ========== 数据结构 ==========

// Account 资金账户
type Account struct {
	ID        uuid.UUID `json:"id"`
	UserID    uuid.UUID `json:"user_id"`
	Balance   float64   `json:"balance"`   // 可用余额（元）
	Frozen    float64   `json:"frozen"`    // 冻结金额（元）
	TotalIn   float64   `json:"total_in"`  // 累计入账
	TotalOut  float64   `json:"total_out"` // 累计出账
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Transaction 资金流水
type Transaction struct {
	ID            uuid.UUID  `json:"id"`
	UserID        uuid.UUID  `json:"user_id"`
	AccountID     uuid.UUID  `json:"account_id"`
	Type          string     `json:"type"`           // DEPOSIT / WITHDRAW / FREEZE / UNFREEZE / TRADE_DEDUCT / TRADE_INCOME / REFUND
	Amount        float64    `json:"amount"`         // 金额
	BalanceBefore float64    `json:"balance_before"` // 变动前可用余额
	BalanceAfter  float64    `json:"balance_after"`  // 变动后可用余额
	FrozenBefore  float64    `json:"frozen_before"`  // 变动前冻结额
	FrozenAfter   float64    `json:"frozen_after"`   // 变动后冻结额
	RefID         *uuid.UUID `json:"ref_id,omitempty"`
	RefType       *string    `json:"ref_type,omitempty"`
	Remark        *string    `json:"remark,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

// MarginHold 保证金冻结记录
type MarginHold struct {
	ID             uuid.UUID `json:"id"`
	UserID         uuid.UUID `json:"user_id"`
	AccountID      uuid.UUID `json:"account_id"`
	ListingID      uuid.UUID `json:"listing_id"`
	ProductID      string    `json:"product_id"`
	Side           string    `json:"side"`
	Price          float64   `json:"price"`
	Quantity       float64   `json:"quantity"`
	MarginRate     float64   `json:"margin_rate"`
	HoldAmount     float64   `json:"hold_amount"`
	ReleasedAmount float64   `json:"released_amount"`
	Status         string    `json:"status"` // HELD / RELEASED / CANCELLED
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// ========== 事务类型常量 ==========

const (
	TxDeposit     = "DEPOSIT"      // 充值
	TxWithdraw    = "WITHDRAW"     // 提现
	TxFreeze      = "FREEZE"       // 冻结保证金
	TxUnfreeze    = "UNFREEZE"     // 解冻保证金（撤单）
	TxTradeDeduct = "TRADE_DEDUCT" // 成交扣款（卖方收款、买方已冻结保证金转为扣款）
	TxTradeIncome = "TRADE_INCOME" // 成交收款
	TxRefund      = "REFUND"       // 退款（多余保证金退回）
)

// 默认保证金比例（10%）
const DefaultMarginRate = 0.10

// ========== AccountRepo ==========

type AccountRepo struct {
	pool *pgxpool.Pool
}

func NewAccountRepo(pool *pgxpool.Pool) *AccountRepo {
	return &AccountRepo{pool: pool}
}

// GetOrCreate 获取账户，若不存在则自动创建（首次登录时调用）
func (r *AccountRepo) GetOrCreate(ctx context.Context, userID uuid.UUID) (*Account, error) {
	acc, err := r.GetByUserID(ctx, userID)
	if err == nil {
		return acc, nil
	}
	if err != ErrNotFound {
		return nil, err
	}
	// 账户不存在，创建
	return r.create(ctx, userID)
}

func (r *AccountRepo) create(ctx context.Context, userID uuid.UUID) (*Account, error) {
	var acc Account
	err := r.pool.QueryRow(ctx, `
		INSERT INTO accounts (user_id)
		VALUES ($1)
		ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
		RETURNING id, user_id, balance, frozen, total_in, total_out, created_at, updated_at
	`, userID).Scan(
		&acc.ID, &acc.UserID, &acc.Balance, &acc.Frozen,
		&acc.TotalIn, &acc.TotalOut, &acc.CreatedAt, &acc.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create account: %w", err)
	}
	return &acc, nil
}

// GetByUserID 按用户 ID 查账户
func (r *AccountRepo) GetByUserID(ctx context.Context, userID uuid.UUID) (*Account, error) {
	var acc Account
	err := r.pool.QueryRow(ctx, `
		SELECT id, user_id, balance, frozen, total_in, total_out, created_at, updated_at
		FROM accounts
		WHERE user_id = $1
	`, userID).Scan(
		&acc.ID, &acc.UserID, &acc.Balance, &acc.Frozen,
		&acc.TotalIn, &acc.TotalOut, &acc.CreatedAt, &acc.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get account by user_id: %w", err)
	}
	return &acc, nil
}

// Deposit 充值（增加可用余额）
func (r *AccountRepo) Deposit(ctx context.Context, userID uuid.UUID, amount float64, remark string) (*Account, *Transaction, error) {
	if amount <= 0 {
		return nil, nil, fmt.Errorf("充值金额必须大于 0")
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)

	// 锁定账户行
	acc, err := lockAccount(ctx, tx, userID)
	if err != nil {
		return nil, nil, err
	}

	newBalance := acc.Balance + amount
	newTotalIn := acc.TotalIn + amount

	// 更新余额
	if err := updateAccountBalance(ctx, tx, acc.ID, newBalance, acc.Frozen, newTotalIn, acc.TotalOut); err != nil {
		return nil, nil, err
	}

	// 记录流水
	t, err := insertTransaction(ctx, tx, &Transaction{
		UserID:        userID,
		AccountID:     acc.ID,
		Type:          TxDeposit,
		Amount:        amount,
		BalanceBefore: acc.Balance,
		BalanceAfter:  newBalance,
		FrozenBefore:  acc.Frozen,
		FrozenAfter:   acc.Frozen,
		Remark:        &remark,
	})
	if err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}

	acc.Balance = newBalance
	acc.TotalIn = newTotalIn
	return acc, t, nil
}

// Withdraw 提现（减少可用余额）
func (r *AccountRepo) Withdraw(ctx context.Context, userID uuid.UUID, amount float64, remark string) (*Account, *Transaction, error) {
	if amount <= 0 {
		return nil, nil, fmt.Errorf("提现金额必须大于 0")
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)

	acc, err := lockAccount(ctx, tx, userID)
	if err != nil {
		return nil, nil, err
	}

	if acc.Balance < amount {
		return nil, nil, fmt.Errorf("可用余额不足，当前余额 %.2f 元，提现 %.2f 元", acc.Balance, amount)
	}

	newBalance := acc.Balance - amount
	newTotalOut := acc.TotalOut + amount

	if err := updateAccountBalance(ctx, tx, acc.ID, newBalance, acc.Frozen, acc.TotalIn, newTotalOut); err != nil {
		return nil, nil, err
	}

	t, err := insertTransaction(ctx, tx, &Transaction{
		UserID:        userID,
		AccountID:     acc.ID,
		Type:          TxWithdraw,
		Amount:        amount,
		BalanceBefore: acc.Balance,
		BalanceAfter:  newBalance,
		FrozenBefore:  acc.Frozen,
		FrozenAfter:   acc.Frozen,
		Remark:        &remark,
	})
	if err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}

	acc.Balance = newBalance
	acc.TotalOut = newTotalOut
	return acc, t, nil
}

// FreezeMargin 冻结保证金（下单时调用）
// 冻结金额 = price * quantity * marginRate
func (r *AccountRepo) FreezeMargin(ctx context.Context, userID uuid.UUID, listingID uuid.UUID,
	productID, side string, price, quantity, marginRate float64) (*MarginHold, error) {

	holdAmount := roundCents(price * quantity * marginRate)
	if holdAmount <= 0 {
		holdAmount = 0.01 // 最低冻结 0.01 元
	}

	// 确保账户存在（注册时未必创建 accounts 行）
	if _, err := r.GetOrCreate(ctx, userID); err != nil {
		return nil, fmt.Errorf("获取资金账户失败: %w", err)
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	acc, err := lockAccount(ctx, tx, userID)
	if err != nil {
		return nil, err
	}

	if acc.Balance < holdAmount {
		return nil, fmt.Errorf("可用余额不足，需冻结保证金 %.2f 元，当前可用余额 %.2f 元", holdAmount, acc.Balance)
	}

	newBalance := acc.Balance - holdAmount
	newFrozen := acc.Frozen + holdAmount

	if err := updateAccountBalance(ctx, tx, acc.ID, newBalance, newFrozen, acc.TotalIn, acc.TotalOut); err != nil {
		return nil, err
	}

	// 写保证金冻结记录
	var hold MarginHold
	err = tx.QueryRow(ctx, `
		INSERT INTO margin_holds
			(user_id, account_id, listing_id, product_id, side, price, quantity, margin_rate, hold_amount, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'HELD')
		RETURNING id, user_id, account_id, listing_id, product_id, side, price, quantity,
		          margin_rate, hold_amount, released_amount, status, created_at, updated_at
	`, userID, acc.ID, listingID, productID, side, price, quantity, marginRate, holdAmount,
	).Scan(
		&hold.ID, &hold.UserID, &hold.AccountID, &hold.ListingID,
		&hold.ProductID, &hold.Side, &hold.Price, &hold.Quantity,
		&hold.MarginRate, &hold.HoldAmount, &hold.ReleasedAmount,
		&hold.Status, &hold.CreatedAt, &hold.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert margin_hold: %w", err)
	}

	// 流水
	remark := fmt.Sprintf("挂牌保证金冻结 listing=%s", listingID)
	_, err = insertTransaction(ctx, tx, &Transaction{
		UserID:        userID,
		AccountID:     acc.ID,
		Type:          TxFreeze,
		Amount:        holdAmount,
		BalanceBefore: acc.Balance,
		BalanceAfter:  newBalance,
		FrozenBefore:  acc.Frozen,
		FrozenAfter:   newFrozen,
		RefID:         &listingID,
		RefType:       strPtr("listing"),
		Remark:        &remark,
	})
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &hold, nil
}

// ReleaseMargin 解冻保证金（撤单时调用）
func (r *AccountRepo) ReleaseMargin(ctx context.Context, listingID uuid.UUID) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// 查保证金记录
	var hold MarginHold
	err = tx.QueryRow(ctx, `
		SELECT id, user_id, account_id, listing_id, hold_amount, released_amount, status
		FROM margin_holds
		WHERE listing_id = $1 AND status = 'HELD'
		FOR UPDATE
	`, listingID).Scan(
		&hold.ID, &hold.UserID, &hold.AccountID, &hold.ListingID,
		&hold.HoldAmount, &hold.ReleasedAmount, &hold.Status,
	)
	if err == pgx.ErrNoRows {
		// 无保证金记录，直接返回（可能未启用保证金或已释放）
		return tx.Commit(ctx)
	}
	if err != nil {
		return fmt.Errorf("query margin_hold: %w", err)
	}

	// 计算剩余未释放金额
	remainAmount := roundCents(hold.HoldAmount - hold.ReleasedAmount)
	if remainAmount <= 0 {
		return tx.Commit(ctx) // 已全部释放
	}

	// 锁定账户
	acc, err := lockAccountByID(ctx, tx, hold.AccountID)
	if err != nil {
		return err
	}

	newBalance := acc.Balance + remainAmount
	newFrozen := acc.Frozen - remainAmount
	if newFrozen < 0 {
		newFrozen = 0
	}

	if err := updateAccountBalance(ctx, tx, acc.ID, newBalance, newFrozen, acc.TotalIn, acc.TotalOut); err != nil {
		return err
	}

	// 更新保证金记录为 CANCELLED
	_, err = tx.Exec(ctx, `
		UPDATE margin_holds
		SET status = 'CANCELLED', released_amount = hold_amount, updated_at = NOW()
		WHERE id = $1
	`, hold.ID)
	if err != nil {
		return fmt.Errorf("update margin_hold: %w", err)
	}

	// 流水
	remark := fmt.Sprintf("撤单解冻保证金 listing=%s", listingID)
	_, err = insertTransaction(ctx, tx, &Transaction{
		UserID:        hold.UserID,
		AccountID:     hold.AccountID,
		Type:          TxUnfreeze,
		Amount:        remainAmount,
		BalanceBefore: acc.Balance,
		BalanceAfter:  newBalance,
		FrozenBefore:  acc.Frozen,
		FrozenAfter:   newFrozen,
		RefID:         &listingID,
		RefType:       strPtr("listing"),
		Remark:        &remark,
	})
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// SettleTrade 成交结算（成交后调用）
// 买方：从冻结保证金中扣除实际成交额，多余保证金退回可用余额
// 卖方：收到成交款项（加入可用余额）
//
// 注意：化工现货平台的保证金模型：
//   - 买方下单时冻结 price*qty*marginRate（如10%）作为履约保证金
//   - 成交时买方保证金全额扣除（不足部分需补足），成交款从可用余额扣除
//   - 卖方收到货款进入可用余额（T+N 结算，这里简化为即时到账）
func (r *AccountRepo) SettleTrade(ctx context.Context,
	buyUserID, sellUserID uuid.UUID,
	listingID uuid.UUID, // 触发成交的挂牌 ID（买方挂牌）
	tradeID uuid.UUID,
	price, quantity float64,
) error {

	tradeAmount := roundCents(price * quantity)

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// --- 买方处理 ---
	buyAcc, err := lockAccount(ctx, tx, buyUserID)
	if err != nil {
		return fmt.Errorf("lock buy account: %w", err)
	}

	// 查买方保证金记录（可能不存在，若保证金功能后来启用）
	var marginHoldAmount float64
	var marginHoldID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT id, hold_amount - released_amount
		FROM margin_holds
		WHERE listing_id = $1 AND status = 'HELD'
		FOR UPDATE
	`, listingID).Scan(&marginHoldID, &marginHoldAmount)
	marginHoldAmount = roundCents(marginHoldAmount)

	buyHasMargin := err == nil && marginHoldAmount > 0

	// 买方需付总货款 = price * quantity
	// 若买方有保证金：从冻结额中扣除 holdAmount 部分，余额支付剩余货款
	// 若买方无保证金：直接从可用余额扣除货款
	var buyBalanceDeduct float64
	var buyFrozenDeduct float64

	if buyHasMargin {
		// 本次成交应用掉的保证金比例（按成交量/挂牌量等比例）
		holdToUse := roundCents(marginHoldAmount) // 全部用完（简化：整笔成交）
		if holdToUse > tradeAmount {
			holdToUse = tradeAmount
		}
		buyFrozenDeduct = holdToUse
		buyBalanceDeduct = roundCents(tradeAmount - holdToUse) // 不足保证金的部分从余额扣
	} else {
		buyBalanceDeduct = tradeAmount
		buyFrozenDeduct = 0
	}

	if buyAcc.Balance < buyBalanceDeduct {
		return fmt.Errorf("买方可用余额不足，需 %.2f 元，当前可用 %.2f 元", buyBalanceDeduct, buyAcc.Balance)
	}

	newBuyBalance := buyAcc.Balance - buyBalanceDeduct
	newBuyFrozen := buyAcc.Frozen - buyFrozenDeduct
	if newBuyFrozen < 0 {
		newBuyFrozen = 0
	}
	newBuyTotalOut := buyAcc.TotalOut + tradeAmount

	if err := updateAccountBalance(ctx, tx, buyAcc.ID, newBuyBalance, newBuyFrozen, buyAcc.TotalIn, newBuyTotalOut); err != nil {
		return fmt.Errorf("update buy account: %w", err)
	}

	// 若有保证金记录，更新 released_amount
	if buyHasMargin {
		_, err = tx.Exec(ctx, `
			UPDATE margin_holds
			SET released_amount = hold_amount, status = 'RELEASED', updated_at = NOW()
			WHERE id = $1
		`, marginHoldID)
		if err != nil {
			return fmt.Errorf("update margin_hold released: %w", err)
		}
	}

	// 买方流水
	remark := fmt.Sprintf("成交扣款 trade=%s price=%.2f qty=%.2f", tradeID, price, quantity)
	_, err = insertTransaction(ctx, tx, &Transaction{
		UserID:        buyUserID,
		AccountID:     buyAcc.ID,
		Type:          TxTradeDeduct,
		Amount:        tradeAmount,
		BalanceBefore: buyAcc.Balance,
		BalanceAfter:  newBuyBalance,
		FrozenBefore:  buyAcc.Frozen,
		FrozenAfter:   newBuyFrozen,
		RefID:         &tradeID,
		RefType:       strPtr("trade"),
		Remark:        &remark,
	})
	if err != nil {
		return fmt.Errorf("insert buy tx: %w", err)
	}

	// --- 卖方处理 ---
	sellAcc, err := lockAccount(ctx, tx, sellUserID)
	if err != nil {
		return fmt.Errorf("lock sell account: %w", err)
	}

	newSellBalance := sellAcc.Balance + tradeAmount
	newSellTotalIn := sellAcc.TotalIn + tradeAmount

	if err := updateAccountBalance(ctx, tx, sellAcc.ID, newSellBalance, sellAcc.Frozen, newSellTotalIn, sellAcc.TotalOut); err != nil {
		return fmt.Errorf("update sell account: %w", err)
	}

	// 卖方流水
	remark = fmt.Sprintf("成交收款 trade=%s price=%.2f qty=%.2f", tradeID, price, quantity)
	_, err = insertTransaction(ctx, tx, &Transaction{
		UserID:        sellUserID,
		AccountID:     sellAcc.ID,
		Type:          TxTradeIncome,
		Amount:        tradeAmount,
		BalanceBefore: sellAcc.Balance,
		BalanceAfter:  newSellBalance,
		FrozenBefore:  sellAcc.Frozen,
		FrozenAfter:   sellAcc.Frozen,
		RefID:         &tradeID,
		RefType:       strPtr("trade"),
		Remark:        &remark,
	})
	if err != nil {
		return fmt.Errorf("insert sell tx: %w", err)
	}

	return tx.Commit(ctx)
}

// ListTransactions 查询用户资金流水
func (r *AccountRepo) ListTransactions(ctx context.Context, userID uuid.UUID, limit, offset int) ([]Transaction, int, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	var total int
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM transactions WHERE user_id = $1`, userID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	rows, err := r.pool.Query(ctx, `
		SELECT id, user_id, account_id, type, amount,
		       balance_before, balance_after, frozen_before, frozen_after,
		       ref_id, ref_type, remark, created_at
		FROM transactions
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var txs []Transaction
	for rows.Next() {
		var t Transaction
		if err := rows.Scan(
			&t.ID, &t.UserID, &t.AccountID, &t.Type, &t.Amount,
			&t.BalanceBefore, &t.BalanceAfter, &t.FrozenBefore, &t.FrozenAfter,
			&t.RefID, &t.RefType, &t.Remark, &t.CreatedAt,
		); err != nil {
			return nil, 0, err
		}
		txs = append(txs, t)
	}
	if txs == nil {
		txs = []Transaction{}
	}
	return txs, total, nil
}

// GetMarginHoldByListing 查保证金记录（用于下单前检查）
func (r *AccountRepo) GetMarginHoldByListing(ctx context.Context, listingID uuid.UUID) (*MarginHold, error) {
	var hold MarginHold
	err := r.pool.QueryRow(ctx, `
		SELECT id, user_id, account_id, listing_id, product_id, side, price, quantity,
		       margin_rate, hold_amount, released_amount, status, created_at, updated_at
		FROM margin_holds
		WHERE listing_id = $1
	`, listingID).Scan(
		&hold.ID, &hold.UserID, &hold.AccountID, &hold.ListingID,
		&hold.ProductID, &hold.Side, &hold.Price, &hold.Quantity,
		&hold.MarginRate, &hold.HoldAmount, &hold.ReleasedAmount,
		&hold.Status, &hold.CreatedAt, &hold.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &hold, nil
}

// ========== 内部辅助函数 ==========

// lockAccount 加行锁（FOR UPDATE）查账户
func lockAccount(ctx context.Context, tx pgx.Tx, userID uuid.UUID) (*Account, error) {
	var acc Account
	err := tx.QueryRow(ctx, `
		SELECT id, user_id, balance, frozen, total_in, total_out, created_at, updated_at
		FROM accounts
		WHERE user_id = $1
		FOR UPDATE
	`, userID).Scan(
		&acc.ID, &acc.UserID, &acc.Balance, &acc.Frozen,
		&acc.TotalIn, &acc.TotalOut, &acc.CreatedAt, &acc.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("lock account: %w", err)
	}
	return &acc, nil
}

// lockAccountByID 按 account.id 加锁
func lockAccountByID(ctx context.Context, tx pgx.Tx, accountID uuid.UUID) (*Account, error) {
	var acc Account
	err := tx.QueryRow(ctx, `
		SELECT id, user_id, balance, frozen, total_in, total_out, created_at, updated_at
		FROM accounts
		WHERE id = $1
		FOR UPDATE
	`, accountID).Scan(
		&acc.ID, &acc.UserID, &acc.Balance, &acc.Frozen,
		&acc.TotalIn, &acc.TotalOut, &acc.CreatedAt, &acc.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("lock account by id: %w", err)
	}
	return &acc, nil
}

func updateAccountBalance(ctx context.Context, tx pgx.Tx, accountID uuid.UUID,
	balance, frozen, totalIn, totalOut float64) error {
	_, err := tx.Exec(ctx, `
		UPDATE accounts
		SET balance = $2, frozen = $3, total_in = $4, total_out = $5, updated_at = NOW()
		WHERE id = $1
	`, accountID, balance, frozen, totalIn, totalOut)
	return err
}

func insertTransaction(ctx context.Context, tx pgx.Tx, t *Transaction) (*Transaction, error) {
	err := tx.QueryRow(ctx, `
		INSERT INTO transactions
			(user_id, account_id, type, amount,
			 balance_before, balance_after, frozen_before, frozen_after,
			 ref_id, ref_type, remark)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, created_at
	`,
		t.UserID, t.AccountID, t.Type, t.Amount,
		t.BalanceBefore, t.BalanceAfter, t.FrozenBefore, t.FrozenAfter,
		t.RefID, t.RefType, t.Remark,
	).Scan(&t.ID, &t.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("insert transaction: %w", err)
	}
	return t, nil
}

// roundCents 精确到分（避免浮点误差）
func roundCents(v float64) float64 {
	// math.Round 精度到分
	result := float64(int64(v*100+0.5)) / 100
	return result
}

func strPtr(s string) *string {
	return &s
}
