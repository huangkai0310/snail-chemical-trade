-- 027: swap_listings 加 allow_counter_offer 列（是否接受商谈）
-- 与 listings.allow_counter_offer 对齐，默认 TRUE（可商谈）
ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS allow_counter_offer BOOLEAN DEFAULT TRUE;
