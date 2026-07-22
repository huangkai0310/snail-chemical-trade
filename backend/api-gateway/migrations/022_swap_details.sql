-- 022: 为换盘补充交割方式、免仓期、规格字段
-- 说明：sell_payment_method / buy_payment_method 已在 017 添加；
-- 本迁移补充每腿的：交割方式 / 免仓期（免仓开关+天数）/ 规格。
-- 规格使用 JSONB（与普通挂牌 listings.specs 保持一致）。

ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS sell_delivery_method VARCHAR(64);
ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS buy_delivery_method VARCHAR(64);

ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS sell_free_storage_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS buy_free_storage_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS sell_free_storage_days INTEGER;
ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS buy_free_storage_days INTEGER;

ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS sell_specs JSONB;
ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS buy_specs JSONB;
