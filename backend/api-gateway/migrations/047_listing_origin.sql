-- 047: 挂牌来源。摘盘产生的对向单仅作撮合/成交关联，不出现在盘面发盘列表
ALTER TABLE listings ADD COLUMN IF NOT EXISTS origin VARCHAR(20) NOT NULL DEFAULT 'post';

COMMENT ON COLUMN listings.origin IS 'post=主动发盘, take=摘盘对向单(不展示在盘面/我的挂盘)';

CREATE INDEX IF NOT EXISTS idx_listings_origin ON listings (origin);
