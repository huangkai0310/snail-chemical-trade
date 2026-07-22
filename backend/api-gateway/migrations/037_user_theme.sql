-- 037: 界面主题随账号持久化（暗色/亮色）；NULL 表示尚未设置，避免覆盖本机已选主题
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS theme VARCHAR(16);

COMMENT ON COLUMN user_preferences.theme IS '界面主题：dark | light；NULL=未设置';
