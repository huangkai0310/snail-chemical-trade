-- 043_expires_at.sql
-- 发盘 / 换盘过期时间：默认当日 18:00（由应用层写入）

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE swap_listings
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- 存量 OPEN/PARTIAL：按创建日当天 18:00（上海时区）；若创建已过当日 18:00 则次日 18:00
UPDATE listings
SET expires_at = (
  CASE
    WHEN (created_at AT TIME ZONE 'Asia/Shanghai')::time < TIME '18:00'
    THEN ((created_at AT TIME ZONE 'Asia/Shanghai')::date + TIME '18:00') AT TIME ZONE 'Asia/Shanghai'
    ELSE (((created_at AT TIME ZONE 'Asia/Shanghai')::date + INTERVAL '1 day') + TIME '18:00') AT TIME ZONE 'Asia/Shanghai'
  END
)
WHERE expires_at IS NULL
  AND status IN ('OPEN', 'PARTIAL');

UPDATE swap_listings
SET expires_at = (
  CASE
    WHEN (created_at AT TIME ZONE 'Asia/Shanghai')::time < TIME '18:00'
    THEN ((created_at AT TIME ZONE 'Asia/Shanghai')::date + TIME '18:00') AT TIME ZONE 'Asia/Shanghai'
    ELSE (((created_at AT TIME ZONE 'Asia/Shanghai')::date + INTERVAL '1 day') + TIME '18:00') AT TIME ZONE 'Asia/Shanghai'
  END
)
WHERE expires_at IS NULL
  AND status = 'OPEN';

CREATE INDEX IF NOT EXISTS idx_listings_expires_at
  ON listings (expires_at)
  WHERE status IN ('OPEN', 'PARTIAL');

CREATE INDEX IF NOT EXISTS idx_swap_listings_expires_at
  ON swap_listings (expires_at)
  WHERE status = 'OPEN';
