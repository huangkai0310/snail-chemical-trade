-- =============================================
-- 019: 发盘允许议价开关 + 修复默认不可拆单
-- =============================================

-- listings 表新增"是否允许议价"字段（默认可议价）
ALTER TABLE listings ADD COLUMN IF NOT EXISTS allow_counter_offer BOOLEAN NOT NULL DEFAULT true;

-- 修复：发盘默认不可拆单
-- 原 005 migration 将 allow_partial 设为 DEFAULT true，导致所有新发盘默认可拆。
-- 仅修改列默认值，已存在的数据保持不变。
-- 如需将历史发盘批量改为不可拆（请确认业务影响后再执行）：
--   UPDATE listings SET allow_partial = false WHERE allow_partial = true AND status IN ('OPEN','PARTIAL');
ALTER TABLE listings ALTER COLUMN allow_partial SET DEFAULT false;
