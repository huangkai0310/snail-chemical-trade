-- 025_listing_negotiable_terms.sql
-- 发盘「可议条款范围」：记录一笔挂牌允许对方就哪些条款发起议价。
-- allow_counter_offer 仅控制「是否可议」；negotiable_terms 控制「可议哪些条款」。
-- 条款键：price 价格 / quantity 数量 / delivery_period 交割期 / delivery_location 交割地
--        / payment_method 付款方式 / delivery_method 交割方式 / free_storage 免仓期 / specs 规格
-- 默认全选（可议且全部条款均可协商）。

ALTER TABLE listings ADD COLUMN IF NOT EXISTS negotiable_terms JSONB NOT NULL DEFAULT '["price","quantity","delivery_period","delivery_location","payment_method","delivery_method","free_storage","specs"]'::jsonb;
