-- 024_counter_offer_negotiable_terms.sql
-- 议价可协商更多元素：交割期、交割地、付款方式、交割方式、免仓、规格
-- （价格、数量此前已支持）

ALTER TABLE counter_offers ADD COLUMN IF NOT EXISTS offer_delivery_period VARCHAR(64);
ALTER TABLE counter_offers ADD COLUMN IF NOT EXISTS offer_delivery_location VARCHAR(128);
ALTER TABLE counter_offers ADD COLUMN IF NOT EXISTS offer_payment_method VARCHAR(64);
ALTER TABLE counter_offers ADD COLUMN IF NOT EXISTS offer_delivery_method VARCHAR(64);
ALTER TABLE counter_offers ADD COLUMN IF NOT EXISTS offer_free_storage_enabled BOOLEAN;
ALTER TABLE counter_offers ADD COLUMN IF NOT EXISTS offer_free_storage_days INTEGER;
ALTER TABLE counter_offers ADD COLUMN IF NOT EXISTS offer_specs TEXT;
