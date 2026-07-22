-- 036: 同人吃买卖两腿的自闪拼/自配对，改标为 swap_private（不计入行情）
-- 场景：先单边锁定，再对自己反侧锁定闪拼；或两边均由同一 acceptor 完成

UPDATE trades t
SET source = 'swap_private'
FROM swap_matches flash
WHERE t.buy_order_id = flash.id
  AND t.source = 'swap'
  AND flash.match_side IN ('sell', 'buy')
  AND flash.lock_status = 'FLASHED'
  AND EXISTS (
    SELECT 1
    FROM swap_matches prior_lock
    WHERE prior_lock.swap_a_id = flash.swap_a_id
      AND prior_lock.id <> flash.id
      AND prior_lock.acceptor_id = flash.acceptor_id
      AND prior_lock.match_side IN ('sell', 'buy')
      AND prior_lock.match_side <> flash.match_side
      AND prior_lock.lock_status = 'FLASHED'
      AND prior_lock.matched_at <= flash.matched_at
      AND prior_lock.matched_at >= flash.matched_at - INTERVAL '10 minutes'
  );
