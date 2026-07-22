-- 044_starts_at.sql
-- 预设发盘：开始时间到点后自动从 SCHEDULED 变为 OPEN

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;

ALTER TABLE swap_listings
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;

ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_check;
ALTER TABLE listings ADD CONSTRAINT listings_status_check
    CHECK (status IN ('OPEN', 'PARTIAL', 'FILLED', 'CANCELLED', 'EXPIRED', 'SCHEDULED'));

CREATE INDEX IF NOT EXISTS idx_listings_starts_at
  ON listings (starts_at)
  WHERE status = 'SCHEDULED';

CREATE INDEX IF NOT EXISTS idx_swap_listings_starts_at
  ON swap_listings (starts_at)
  WHERE status = 'SCHEDULED';
