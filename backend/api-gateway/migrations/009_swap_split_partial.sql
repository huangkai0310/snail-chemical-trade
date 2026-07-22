-- 换盘卖腿/买腿独立拆单字段
ALTER TABLE swap_listings
    ADD COLUMN IF NOT EXISTS sell_allow_partial BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS sell_min_quantity  NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS buy_allow_partial  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS buy_min_quantity   NUMERIC(14,2) NOT NULL DEFAULT 0;

-- 注意：历史上曾用 UPDATE 把 legacy min_quantity/allow_partial 拷到新列。
-- 因 Create/Update 只写新列、不回写 legacy，且 RunMigrations 曾每次启动重跑，
-- 导致新列被反复覆盖为 legacy 的 0。此处已去掉该 UPDATE；
-- 存量迁移由 schema_migrations 保证每个文件只执行一次。
