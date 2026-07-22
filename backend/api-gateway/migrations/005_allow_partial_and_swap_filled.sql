-- =============================================
-- 005: 挂牌允许拆单 + 换盘还盘进度
-- =============================================

-- listings 表增加"是否允许拆单"字段
ALTER TABLE listings ADD COLUMN IF NOT EXISTS allow_partial BOOLEAN NOT NULL DEFAULT true;

-- swap_listings 表增加已匹配数量（支持多方还盘凑满）
ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS sell_filled   NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS buy_filled    NUMERIC(12,2) NOT NULL DEFAULT 0;
