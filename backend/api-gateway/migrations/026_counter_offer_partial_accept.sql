-- 026_counter_offer_partial_accept.sql
-- 议价条款级「部分接受」支持：
-- accepted_terms 记录挂牌方(接收方)勾选接受的条款键（JSON 数组），用于最终成交时决定哪些条款采用议价方报价。
-- 状态 PARTIAL_ACCEPTED 为应用层字符串（counter_offers.status 为 VARCHAR，无需改动类型）：
--   挂牌方仅接受部分条款 → PARTIAL_ACCEPTED，等待发起方二次确认；发起方确认即成交，拒绝则撤销。

ALTER TABLE counter_offers ADD COLUMN IF NOT EXISTS accepted_terms JSONB;
