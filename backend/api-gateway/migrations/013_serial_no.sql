-- =============================================
-- 013: 为挂牌和换盘添加 serial_no 唯一序号
-- =============================================

-- listings 表添加 serial_no 列（全局自增序号）
ALTER TABLE listings ADD COLUMN IF NOT EXISTS serial_no BIGSERIAL;

CREATE INDEX IF NOT EXISTS idx_listings_serial_no ON listings(serial_no);

-- swap_listings 表添加 serial_no 列（全局自增序号）
ALTER TABLE swap_listings ADD COLUMN IF NOT EXISTS serial_no BIGSERIAL;

CREATE INDEX IF NOT EXISTS idx_swap_listings_serial_no ON swap_listings(serial_no);
