-- =============================================
-- 004: 换盘业务
-- =============================================

-- 换盘挂牌表：每条记录代表一个"我要换"的组合
-- 包含两条腿：want_to_buy（我求购那边）+ want_to_sell（我出售那边）
CREATE TABLE IF NOT EXISTS swap_listings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id),
    product_id      VARCHAR(32) NOT NULL REFERENCES products(id),   -- 主品种（我卖出的那边）
    status          VARCHAR(16) NOT NULL DEFAULT 'OPEN',             -- OPEN / MATCHED / CANCELLED

    -- 我方卖腿（want_to_sell = 我愿意卖出的）
    sell_product_id     VARCHAR(32) NOT NULL REFERENCES products(id),
    sell_price          NUMERIC(12,2) NOT NULL,
    sell_quantity       NUMERIC(12,2) NOT NULL,
    sell_delivery_period  VARCHAR(32),
    sell_delivery_location VARCHAR(256),

    -- 我方买腿（want_to_buy = 我希望换到的）
    buy_product_id      VARCHAR(32) NOT NULL REFERENCES products(id),
    buy_price           NUMERIC(12,2) NOT NULL,
    buy_quantity        NUMERIC(12,2) NOT NULL,
    buy_delivery_period   VARCHAR(32),
    buy_delivery_location  VARCHAR(256),

    remark          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_swap_listings_user_id    ON swap_listings(user_id);
CREATE INDEX IF NOT EXISTS idx_swap_listings_status     ON swap_listings(status);
CREATE INDEX IF NOT EXISTS idx_swap_listings_product    ON swap_listings(sell_product_id, status);
CREATE INDEX IF NOT EXISTS idx_swap_listings_created_at ON swap_listings(created_at DESC);

-- 换盘匹配记录：记录两个 swap_listing 成功配对的历史
CREATE TABLE IF NOT EXISTS swap_matches (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    swap_a_id       UUID NOT NULL REFERENCES swap_listings(id),   -- 发起方
    swap_b_id       UUID NOT NULL REFERENCES swap_listings(id),   -- 接受方
    product_id      VARCHAR(32) NOT NULL,
    matched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_swap_matches_swap_a  ON swap_matches(swap_a_id);
CREATE INDEX IF NOT EXISTS idx_swap_matches_swap_b  ON swap_matches(swap_b_id);
