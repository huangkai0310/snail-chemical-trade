-- 002_wal_and_indexes.sql
-- 撮合引擎WAL日志表 + 补充索引 + delivery_location列（如果不存在）

-- ========== 撮合引擎 WAL 日志 ==========
CREATE TABLE IF NOT EXISTS engine_wal (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action VARCHAR(32) NOT NULL,          -- PLACE_ORDER | TAKE_LISTING | CANCEL_ORDER
    order_id VARCHAR(64) NOT NULL,
    product_id VARCHAR(32) NOT NULL,
    side VARCHAR(4),                      -- BUY | SELL（撤单时可为空）
    price NUMERIC(12,2),
    quantity NUMERIC(12,2),
    user_id VARCHAR(64),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engine_wal_timestamp ON engine_wal(timestamp);
CREATE INDEX IF NOT EXISTS idx_engine_wal_order_id ON engine_wal(order_id);

-- ========== 补全 trades 表字段 ==========
ALTER TABLE trades ADD COLUMN IF NOT EXISTS delivery_location VARCHAR(256);

-- ========== 补充挂牌表交割期索引（P2-3筛选加速）==========
CREATE INDEX IF NOT EXISTS idx_listings_delivery_period ON listings(delivery_period) WHERE delivery_period IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_product_status ON listings(product_id, status);

-- ========== 补充成交表产品+时间复合索引（P2-2价格走势加速）==========
CREATE INDEX IF NOT EXISTS idx_trades_product_time ON trades(product_id, traded_at DESC);
