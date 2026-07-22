-- 008: 添加最小成交量字段
-- listings 表：普通挂牌最小成交量（可拆单时生效）
ALTER TABLE listings
    ADD COLUMN IF NOT EXISTS min_quantity NUMERIC(14,2) DEFAULT 0;

COMMENT ON COLUMN listings.min_quantity IS '最小成交量（可拆单时生效，0 表示无限制）';

-- swap_listings 表：换盘最小成交量（可拆单时生效）
ALTER TABLE swap_listings
    ADD COLUMN IF NOT EXISTS min_quantity NUMERIC(14,2) DEFAULT 0;

COMMENT ON COLUMN swap_listings.min_quantity IS '最小成交量（可拆单时生效，0 表示无限制）';
