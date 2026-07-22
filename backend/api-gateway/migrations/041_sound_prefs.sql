-- 041: 提示铃声偏好
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS sound_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN user_preferences.sound_prefs IS
  '铃声偏好：{"enabled":true}';
