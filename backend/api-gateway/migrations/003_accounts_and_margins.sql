-- =============================================
-- P3-1: 资金账户 / 保证金体系
-- =============================================

-- 资金账户表（每个用户一个账户）
CREATE TABLE IF NOT EXISTS accounts (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) UNIQUE,
    balance     NUMERIC(16,2) NOT NULL DEFAULT 0,   -- 可用余额（元）
    frozen      NUMERIC(16,2) NOT NULL DEFAULT 0,   -- 冻结金额（保证金占用，元）
    total_in    NUMERIC(16,2) NOT NULL DEFAULT 0,   -- 累计入账（元）
    total_out   NUMERIC(16,2) NOT NULL DEFAULT 0,   -- 累计出账（元）
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_balance_non_negative  CHECK (balance >= 0),
    CONSTRAINT chk_frozen_non_negative   CHECK (frozen  >= 0)
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);

-- 资金流水表（账户每次变动记一条流水）
CREATE TABLE IF NOT EXISTS transactions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id),
    account_id      UUID NOT NULL REFERENCES accounts(id),
    type            VARCHAR(32) NOT NULL,   -- DEPOSIT / WITHDRAW / FREEZE / UNFREEZE / TRADE_DEDUCT / TRADE_INCOME / REFUND
    amount          NUMERIC(16,2) NOT NULL, -- 金额（正数，含义由 type 决定）
    balance_before  NUMERIC(16,2) NOT NULL, -- 变动前可用余额
    balance_after   NUMERIC(16,2) NOT NULL, -- 变动后可用余额
    frozen_before   NUMERIC(16,2) NOT NULL, -- 变动前冻结金额
    frozen_after    NUMERIC(16,2) NOT NULL, -- 变动后冻结金额
    ref_id          UUID,                   -- 关联业务 ID（挂牌 ID / 成交 ID 等）
    ref_type        VARCHAR(32),            -- 关联业务类型（listing / trade）
    remark          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id     ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id  ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_ref_id      ON transactions(ref_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at  ON transactions(created_at DESC);

-- 保证金冻结记录表（每笔挂牌对应一条）
-- 下单时冻结 = price * quantity * margin_ratio (例如 20%，化工现货通常要求 10%~30%)
-- 撤单/成交后解冻/扣除
CREATE TABLE IF NOT EXISTS margin_holds (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id),
    account_id      UUID NOT NULL REFERENCES accounts(id),
    listing_id      UUID NOT NULL REFERENCES listings(id) UNIQUE,  -- 每个挂牌对应一条保证金记录
    product_id      VARCHAR(32) NOT NULL,
    side            VARCHAR(4)  NOT NULL,
    price           NUMERIC(12,2) NOT NULL,
    quantity        NUMERIC(12,2) NOT NULL,
    margin_rate     NUMERIC(6,4) NOT NULL DEFAULT 0.10,  -- 保证金比例 (10%)
    hold_amount     NUMERIC(16,2) NOT NULL,              -- 冻结金额 = price * quantity * margin_rate
    released_amount NUMERIC(16,2) NOT NULL DEFAULT 0,   -- 已释放金额（部分成交时按比例释放）
    status          VARCHAR(16) NOT NULL DEFAULT 'HELD', -- HELD / RELEASED / CANCELLED
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_margin_holds_user_id    ON margin_holds(user_id);
CREATE INDEX IF NOT EXISTS idx_margin_holds_listing_id ON margin_holds(listing_id);
CREATE INDEX IF NOT EXISTS idx_margin_holds_status     ON margin_holds(status);

-- 为 listings 表补充保证金字段（可选，方便查询）
ALTER TABLE listings ADD COLUMN IF NOT EXISTS margin_rate NUMERIC(6,4) DEFAULT 0.10;
