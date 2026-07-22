-- #653 换盘单边交易设置
-- allow_single_side: 是否允许单边交易（默认 true）
-- single_side_mode: 单边模式 both(均可) | single_buy(仅单买) | single_sell(仅单卖) | none(仅双边)
ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS allow_single_side BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS single_side_mode VARCHAR(16) NOT NULL DEFAULT 'both';
