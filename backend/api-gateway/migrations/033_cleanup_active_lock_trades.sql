-- 033: 清理单边锁定误写入的成交（ACTIVE 锁不算成交价）
-- 历史版本：议价接受单边会写入 trades，导致 K 线/最新价被错误更新。
DELETE FROM trades t
USING swap_matches m
WHERE t.buy_order_id = m.id
  AND m.lock_status = 'ACTIVE'
  AND m.match_side IN ('sell', 'buy');
