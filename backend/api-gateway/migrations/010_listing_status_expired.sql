-- 010_listing_status_expired.sql
-- 新增 EXPIRED 状态支持（凌晨12点将当天未成交的挂牌标记为 EXPIRED）
-- 历史数据中存在 CLOSED 状态，迁移到 CANCELLED（逻辑等价：已关闭/已撤盘）

-- 1. 先将历史 CLOSED 数据迁移为 CANCELLED
UPDATE listings SET status = 'CANCELLED', updated_at = NOW()
WHERE status = 'CLOSED';

-- 2. 删除旧约束（若存在）
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_check;

-- 3. 添加新约束（包含所有合法状态）
ALTER TABLE listings ADD CONSTRAINT listings_status_check
    CHECK (status IN ('OPEN', 'PARTIAL', 'FILLED', 'CANCELLED', 'EXPIRED'));

-- 4. 确保 status 索引覆盖 EXPIRED
CREATE INDEX IF NOT EXISTS idx_listings_status_created ON listings(status, created_at DESC);
