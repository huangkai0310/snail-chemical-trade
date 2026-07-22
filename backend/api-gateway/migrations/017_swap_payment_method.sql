-- 017_swap_payment_method.sql
-- 给 swap_listings 表添加付款方式字段（卖腿 + 买腿）
-- 使用 IF NOT EXISTS 确保幂等

ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS sell_payment_method VARCHAR(64);
ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS buy_payment_method VARCHAR(64);
