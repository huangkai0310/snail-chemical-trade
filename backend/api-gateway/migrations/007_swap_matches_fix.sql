-- =============================================
-- 007: 修复换盘匹配记录表结构
-- swap_b_id 改可空（接受方不一定有换盘挂牌）
-- 增加 acceptor_id 记录接受方用户
-- 增加 matched_qty 记录本次匹配数量
-- =============================================

ALTER TABLE swap_matches
    ALTER COLUMN swap_b_id DROP NOT NULL;

ALTER TABLE swap_matches
    ADD COLUMN IF NOT EXISTS acceptor_id UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS matched_qty NUMERIC(12,2) NOT NULL DEFAULT 0;
