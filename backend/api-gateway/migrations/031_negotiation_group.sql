-- 031_negotiation_group.sql
-- 双向换盘商谈：关联同一批次发起的卖盘/买盘商谈

ALTER TABLE counter_offers ADD COLUMN IF NOT EXISTS negotiation_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_counter_offers_neg_group ON counter_offers(negotiation_group_id);
