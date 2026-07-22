-- =============================================
-- 032: 换盘单边锁定状态
-- match_side: sell/buy/both
-- lock_status: ACTIVE（待拼）/ CANCELLED / FLASHED（已拼单成交）
-- =============================================

ALTER TABLE swap_matches
    ADD COLUMN IF NOT EXISTS match_side VARCHAR(8),
    ADD COLUMN IF NOT EXISTS lock_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_swap_matches_lock_status ON swap_matches(swap_a_id, lock_status);
CREATE INDEX IF NOT EXISTS idx_swap_matches_acceptor ON swap_matches(acceptor_id, lock_status);
