-- 021: 扩展 trades 表，记录每笔成交的双边条款明细与成交来源
-- 用于「我的成交」完整展示：序号、付款方式、交割方式、免仓期、规格、成交来源

ALTER TABLE trades ADD COLUMN IF NOT EXISTS buy_serial_no BIGINT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS sell_serial_no BIGINT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS buy_payment_method VARCHAR(100);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS sell_payment_method VARCHAR(100);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(100);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS free_storage_enabled BOOLEAN;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS free_storage_days INTEGER;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS buy_specs JSONB;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS sell_specs JSONB;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'auto';
ALTER TABLE trades ADD COLUMN IF NOT EXISTS aggressor_user_id UUID;

-- 历史成交记录默认为自动撮合（此前系统仅支持被动撮合）
COMMENT ON COLUMN trades.source IS '成交来源: auto=自动撮合, take=主动摘牌, counter_offer=议价成交, swap=换盘成交';
COMMENT ON COLUMN trades.aggressor_user_id IS '主动方用户ID（take/counter_offer 时记录摘牌/议价方）';
