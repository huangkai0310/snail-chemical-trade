-- 015_counter_offer_cancel_reason.sql
-- 议价自动撤销原因：当关联挂牌/换盘被撤销或成交时，PENDING 议价自动置为 CANCELLED 并记录原因

ALTER TABLE counter_offers ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(256);
