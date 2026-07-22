-- 016: 挂牌增加付款方式字段
-- 化工贸易常用付款方式：款到发货 / 货到付款 / 预收保证金(10%) / 见票付款 / 账期结算
ALTER TABLE listings ADD COLUMN IF NOT EXISTS payment_method VARCHAR(64);
