-- 028: swap_listings 加 negotiable_terms 列（可议条款范围）
-- 与 listings.negotiable_terms 对齐：JSONB NOT NULL，默认全选8项条款
ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS negotiable_terms JSONB NOT NULL DEFAULT '["price","quantity","delivery_period","delivery_location","payment_method","delivery_method","free_storage","specs"]'::jsonb;
