-- 045_schedule_reminders.sql
-- 到期/开盘前 5 分钟提醒去重标记

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS expire_reminded_at TIMESTAMPTZ;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS start_reminded_at TIMESTAMPTZ;

ALTER TABLE swap_listings
  ADD COLUMN IF NOT EXISTS expire_reminded_at TIMESTAMPTZ;

ALTER TABLE swap_listings
  ADD COLUMN IF NOT EXISTS start_reminded_at TIMESTAMPTZ;
