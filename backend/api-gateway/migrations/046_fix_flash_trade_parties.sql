-- 046_fix_flash_trade_parties.sql
-- 修复历史闪拼成交：两腿买卖方曾都写成闪拼方，锁定腿应对应原锁定方

-- 闪拼卖侧（match_side=sell）：买腿卖方应为锁定买侧的人，而非闪拼方
UPDATE trades t
SET sell_user_id = lock_m.acceptor_id
FROM swap_matches flash
JOIN swap_listings sl ON sl.id = flash.swap_a_id
JOIN LATERAL (
  SELECT sm.acceptor_id
  FROM swap_matches sm
  WHERE sm.swap_a_id = flash.swap_a_id
    AND sm.id <> flash.id
    AND sm.match_side = 'buy'
    AND sm.acceptor_id IS DISTINCT FROM flash.acceptor_id
    AND sm.matched_at <= flash.matched_at + INTERVAL '1 minute'
  ORDER BY sm.matched_at DESC
  LIMIT 1
) lock_m ON true
WHERE t.buy_order_id = flash.id
  AND t.source IN ('swap', 'swap_private')
  AND flash.lock_status = 'FLASHED'
  AND flash.match_side = 'sell'
  AND t.product_id = sl.buy_product_id
  AND t.sell_user_id = flash.acceptor_id
  AND t.sell_user_id IS DISTINCT FROM lock_m.acceptor_id;

-- 闪拼买侧（match_side=buy）：卖腿买方应为锁定卖侧的人，而非闪拼方
UPDATE trades t
SET buy_user_id = lock_m.acceptor_id
FROM swap_matches flash
JOIN swap_listings sl ON sl.id = flash.swap_a_id
JOIN LATERAL (
  SELECT sm.acceptor_id
  FROM swap_matches sm
  WHERE sm.swap_a_id = flash.swap_a_id
    AND sm.id <> flash.id
    AND sm.match_side = 'sell'
    AND sm.acceptor_id IS DISTINCT FROM flash.acceptor_id
    AND sm.matched_at <= flash.matched_at + INTERVAL '1 minute'
  ORDER BY sm.matched_at DESC
  LIMIT 1
) lock_m ON true
WHERE t.buy_order_id = flash.id
  AND t.source IN ('swap', 'swap_private')
  AND flash.lock_status = 'FLASHED'
  AND flash.match_side = 'buy'
  AND t.product_id = sl.sell_product_id
  AND t.buy_user_id = flash.acceptor_id
  AND t.buy_user_id IS DISTINCT FROM lock_m.acceptor_id;
