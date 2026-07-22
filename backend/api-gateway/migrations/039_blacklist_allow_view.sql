-- =============================================
-- 039: 黑名单增加「是否可见对方发盘」
-- 默认 true：可看对方盘子但不能成交；false：列表中隐藏对方发盘
-- =============================================

ALTER TABLE user_blacklist
  ADD COLUMN IF NOT EXISTS allow_view BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN user_blacklist.allow_view IS '拉黑后是否仍可见对方发盘；默认 true，无论如何均不可成交';
