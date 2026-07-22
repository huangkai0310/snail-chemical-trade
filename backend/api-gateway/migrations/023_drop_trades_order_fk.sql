-- 023: 移除 trades.buy_order_id / sell_order_id 对 listings(id) 的外键约束
-- 原因：成交来源多样（自动撮合/摘牌/议价/换盘），换盘成交的
--        buy_order_id = swap_matches.id，sell_order_id = swap_listings.id，
--        并不存在于 listings 表。原先的外键会导致换盘成交插入时
--        违反约束、事务中止、提交失败（500「提交失败」），
--        使换盘成交始终无法写入 trades 表。
-- 成交来源已由 source 字段区分，order_id 仅作参考，无需外键强约束。

ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_buy_order_id_fkey;
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_sell_order_id_fkey;
