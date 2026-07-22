-- 020: 为挂牌增加交割方式与免仓期两个指标
-- delivery_method: 交割方式（混罐货转/货转/自提/送到，支持自定义），可为空
-- free_storage_enabled: 是否可免仓，默认可免仓（true）
-- free_storage_days: 免仓天数（可免仓时生效，如 7/3），可为空

ALTER TABLE listings ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(64);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS free_storage_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS free_storage_days INTEGER;
