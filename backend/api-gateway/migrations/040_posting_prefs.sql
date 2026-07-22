-- 040: 用户发盘偏好（上一发盘模板，按品种+交割期）
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS posting_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN user_preferences.posting_prefs IS
  '发盘偏好：{"listing":{"product|period":{...}},"swap":{"sellP|sellD|buyP|buyD":{...}}}';
