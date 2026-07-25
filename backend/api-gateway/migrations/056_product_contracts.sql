-- 品种+交割期合约：用户首次发布某交割期时正式建立
CREATE TABLE IF NOT EXISTS product_contracts (
    id              BIGSERIAL PRIMARY KEY,
    product_id      TEXT NOT NULL REFERENCES products(id),
    delivery_period TEXT NOT NULL,
    created_by      UUID REFERENCES users(id),
    first_listing_id UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (product_id, delivery_period)
);

CREATE INDEX IF NOT EXISTS idx_product_contracts_product
    ON product_contracts (product_id);

-- 回填挂盘
INSERT INTO product_contracts (product_id, delivery_period, created_by, created_at)
SELECT
    product_id,
    CASE WHEN delivery_period IS NULL OR TRIM(delivery_period) = '' THEN '现货' ELSE TRIM(delivery_period) END,
    (ARRAY_AGG(user_id ORDER BY created_at ASC))[1],
    MIN(created_at)
FROM listings
GROUP BY 1, 2
ON CONFLICT (product_id, delivery_period) DO NOTHING;

-- 回填换盘卖腿
INSERT INTO product_contracts (product_id, delivery_period, created_by, created_at)
SELECT
    sell_product_id,
    CASE WHEN sell_delivery_period IS NULL OR TRIM(sell_delivery_period) = '' THEN '现货' ELSE TRIM(sell_delivery_period) END,
    (ARRAY_AGG(user_id ORDER BY created_at ASC))[1],
    MIN(created_at)
FROM swap_listings
WHERE sell_product_id IS NOT NULL AND sell_product_id <> ''
GROUP BY 1, 2
ON CONFLICT (product_id, delivery_period) DO NOTHING;

-- 回填换盘买腿
INSERT INTO product_contracts (product_id, delivery_period, created_by, created_at)
SELECT
    buy_product_id,
    CASE WHEN buy_delivery_period IS NULL OR TRIM(buy_delivery_period) = '' THEN '现货' ELSE TRIM(buy_delivery_period) END,
    (ARRAY_AGG(user_id ORDER BY created_at ASC))[1],
    MIN(created_at)
FROM swap_listings
WHERE buy_product_id IS NOT NULL AND buy_product_id <> ''
GROUP BY 1, 2
ON CONFLICT (product_id, delivery_period) DO NOTHING;

-- 确保每个活跃品种至少有「现货」
INSERT INTO product_contracts (product_id, delivery_period)
SELECT id, '现货' FROM products WHERE COALESCE(active, true) = true
ON CONFLICT (product_id, delivery_period) DO NOTHING;
