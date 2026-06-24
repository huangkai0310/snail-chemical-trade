-- 001_init.sql
-- 化工量化交易平台 (Snail Chemical Trade) 核心表

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========== 用户表 ==========
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(256) NOT NULL,
    email VARCHAR(128),
    phone VARCHAR(32),
    company_name VARCHAR(256),
    role VARCHAR(32) NOT NULL DEFAULT 'user',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========== 产品品类 ==========
CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    name_en VARCHAR(128),
    unit VARCHAR(16) NOT NULL DEFAULT '吨',
    category VARCHAR(64),
    sort_order INT DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========== 挂牌单 ==========
CREATE TABLE IF NOT EXISTS listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    product_id VARCHAR(32) NOT NULL REFERENCES products(id),
    side VARCHAR(4) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    price NUMERIC(12,2) NOT NULL,
    quantity NUMERIC(12,2) NOT NULL,
    filled NUMERIC(12,2) NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    delivery_period VARCHAR(32),
    delivery_location VARCHAR(256),
    specs JSONB DEFAULT '{}',
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listings_product_id ON listings(product_id);
CREATE INDEX IF NOT EXISTS idx_listings_user_id ON listings(user_id);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_side_product ON listings(side, product_id, status);

-- ========== 成交记录 ==========
CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id VARCHAR(32) NOT NULL REFERENCES products(id),
    buy_order_id UUID NOT NULL REFERENCES listings(id),
    sell_order_id UUID NOT NULL REFERENCES listings(id),
    buy_user_id UUID NOT NULL REFERENCES users(id),
    sell_user_id UUID NOT NULL REFERENCES users(id),
    price NUMERIC(12,2) NOT NULL,
    quantity NUMERIC(12,2) NOT NULL,
    amount NUMERIC(14,2) GENERATED ALWAYS AS (price * quantity) STORED,
    traded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_product_id ON trades(product_id);
CREATE INDEX IF NOT EXISTS idx_trades_buy_user ON trades(buy_user_id);
CREATE INDEX IF NOT EXISTS idx_trades_sell_user ON trades(sell_user_id);
CREATE INDEX IF NOT EXISTS idx_trades_traded_at ON trades(traded_at);

-- ========== 种子数据 ==========
INSERT INTO products (id, name, name_en, category, sort_order) VALUES
    ('methanol', '甲醇', 'Methanol', '醇类', 1),
    ('pta', 'PTA', 'PTA', '聚酯原料', 2),
    ('benzene', '纯苯', 'Benzene', '芳烃', 3),
    ('ethylene_glycol', '乙二醇', 'Ethylene Glycol', '醇类', 4),
    ('styrene', '苯乙烯', 'Styrene', '芳烃', 5)
ON CONFLICT (id) DO NOTHING;
