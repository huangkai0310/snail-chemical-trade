-- =============================================
-- 006: 换盘挂牌增加"是否允许拆单"字段
-- =============================================

ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS allow_partial BOOLEAN NOT NULL DEFAULT true;
