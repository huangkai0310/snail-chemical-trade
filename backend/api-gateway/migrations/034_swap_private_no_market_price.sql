-- 034: 双方换盘成交不计入行情
-- swap_private = 仅发起方与同一接受方完成的双边换盘，无市场参考意义
-- 历史：match_side='both' 的换盘撮合对应的成交改标为 swap_private

COMMENT ON COLUMN trades.source IS
  '成交来源: auto=自动撮合, take=主动摘牌, counter_offer=议价成交, swap=换盘市场成交(单买+单卖合成/三方，计入行情), swap_private=双方换盘(不计入K线/最新价)';

UPDATE trades t
SET source = 'swap_private'
FROM swap_matches m
WHERE t.buy_order_id = m.id
  AND t.source = 'swap'
  AND m.match_side = 'both';
