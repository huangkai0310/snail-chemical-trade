-- 051_dict_tables.sql
-- 管理后台字典表：交割期 / 交割地 / 产品规格 / 付款方式 / 交割方式 / 免仓默认值
-- 所有字典表采用统一结构：id + name + sort_order + active + created_at
-- 与 listings/swap_listings 中的自由文本字段共存，不破坏存量数据

-- ========== 交割期字典 ==========
CREATE TABLE IF NOT EXISTS dict_delivery_periods (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE,
    sort_order INT DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO dict_delivery_periods (name, sort_order) VALUES
    ('现货', 1),
    ('远期纸货', 2)
ON CONFLICT (name) DO NOTHING;

-- ========== 交割地字典 ==========
CREATE TABLE IF NOT EXISTS dict_delivery_locations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL UNIQUE,
    sort_order INT DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO dict_delivery_locations (name, sort_order) VALUES
    ('华东', 1),
    ('华南', 2),
    ('华北', 3),
    ('山东', 4),
    ('东北', 5),
    ('西北', 6),
    ('西南', 7),
    ('华中', 8)
ON CONFLICT (name) DO NOTHING;

-- ========== 产品规格字典 ==========
CREATE TABLE IF NOT EXISTS dict_product_specs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL UNIQUE,
    sort_order INT DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO dict_product_specs (name, sort_order) VALUES
    ('国标优等品', 1),
    ('国标一等品', 2),
    ('国标合格品', 3),
    ('企标优等品', 4),
    ('企标一等品', 5)
ON CONFLICT (name) DO NOTHING;

-- ========== 付款方式字典 ==========
CREATE TABLE IF NOT EXISTS dict_payment_methods (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL UNIQUE,
    sort_order INT DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO dict_payment_methods (name, sort_order) VALUES
    ('款到发货', 1),
    ('货到付款', 2),
    ('先款后货', 3),
    ('见票付款', 4),
    ('账期结算', 5),
    ('预付10%保证金,交货前付全款', 6)
ON CONFLICT (name) DO NOTHING;

-- ========== 交割方式字典 ==========
CREATE TABLE IF NOT EXISTS dict_delivery_methods (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE,
    sort_order INT DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO dict_delivery_methods (name, sort_order) VALUES
    ('送工', 1),
    ('自提', 2),
    ('到厂', 3),
    ('船上交货', 4)
ON CONFLICT (name) DO NOTHING;

-- ========== 免仓默认值字典 ==========
-- 用于新建挂牌/换盘时的免仓天数默认值推荐
CREATE TABLE IF NOT EXISTS dict_free_storage_defaults (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE,
    days INT NOT NULL,
    min_quantity NUMERIC(12,2) DEFAULT 0,
    sort_order INT DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO dict_free_storage_defaults (name, days, min_quantity, sort_order) VALUES
    ('小批量默认(3天)', 3, 0, 1),
    ('大批量默认(7天)', 7, 100, 2)
ON CONFLICT (name) DO NOTHING;
