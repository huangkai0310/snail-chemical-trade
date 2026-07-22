-- =============================================
-- 038: 成交单号（全局唯一自增序号，展示为 T000001）
-- =============================================

ALTER TABLE trades ADD COLUMN IF NOT EXISTS serial_no BIGSERIAL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_serial_no ON trades(serial_no);
