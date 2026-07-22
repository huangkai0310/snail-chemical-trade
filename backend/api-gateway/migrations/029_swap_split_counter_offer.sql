-- 029: 拆分 swap_listings 的 allow_counter_offer / negotiable_terms 为 sell/buy 各自独立
-- 幂等迁移：使用 IF NOT EXISTS

-- 添加卖出腿商谈字段
ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS sell_allow_counter_offer BOOLEAN DEFAULT false;
ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS sell_negotiable_terms JSONB DEFAULT '[]'::jsonb;

-- 添加买入腿商谈字段
ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS buy_allow_counter_offer BOOLEAN DEFAULT false;
ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS buy_negotiable_terms JSONB DEFAULT '[]'::jsonb;

-- 迁移旧数据：将原 allow_counter_offer / negotiable_terms 复制到 sell/buy 两腿
UPDATE swap_listings
SET sell_allow_counter_offer = COALESCE(allow_counter_offer, false),
    buy_allow_counter_offer = COALESCE(allow_counter_offer, false),
    sell_negotiable_terms = CASE
        WHEN COALESCE(allow_counter_offer, false) = true AND negotiable_terms IS NOT NULL AND negotiable_terms::text != 'null' AND negotiable_terms::text != '{}'
        THEN negotiable_terms
        ELSE '[]'::jsonb
    END,
    buy_negotiable_terms = CASE
        WHEN COALESCE(allow_counter_offer, false) = true AND negotiable_terms IS NOT NULL AND negotiable_terms::text != 'null' AND negotiable_terms::text != '{}'
        THEN negotiable_terms
        ELSE '[]'::jsonb
    END
WHERE sell_allow_counter_offer IS NULL OR buy_allow_counter_offer IS NULL
   OR sell_negotiable_terms IS NULL OR buy_negotiable_terms IS NULL;
