-- 014_counter_offers.sql
-- 还价功能：支持买方对挂牌/换盘发起还价，挂牌方/换盘方可接受或拒绝

CREATE TABLE IF NOT EXISTS counter_offers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ref_type        VARCHAR(16) NOT NULL,                  -- 'listing' 或 'swap'
    ref_id          UUID NOT NULL,                           -- 关联的挂牌/换盘 ID
    mode            VARCHAR(16),                             -- 仅 swap 有效：'sell' / 'buy' / 'both'
    offer_user_id   UUID NOT NULL REFERENCES users(id),      -- 发起还价的用户
    listing_user_id UUID NOT NULL REFERENCES users(id),      -- 挂牌方/换盘方（便于查询）
    offer_price     DOUBLE PRECISION NOT NULL,               -- 还价价格
    offer_quantity  DOUBLE PRECISION NOT NULL,               -- 还价数量
    status          VARCHAR(16) NOT NULL DEFAULT 'PENDING',  -- PENDING / ACCEPTED / REJECTED / EXPIRED
    rejected_reason VARCHAR(256),                            -- 拒绝原因（可选）
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_counter_offers_ref     ON counter_offers(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_counter_offers_listing_user ON counter_offers(listing_user_id, status);
CREATE INDEX IF NOT EXISTS idx_counter_offers_offer_user   ON counter_offers(offer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_counter_offers_status  ON counter_offers(status);
