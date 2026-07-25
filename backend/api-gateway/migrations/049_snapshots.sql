-- 迁移 049: 创建 snapshots 表 (快照数据)
-- 幂等: 使用 IF NOT EXISTS

CREATE TABLE IF NOT EXISTS snapshots (
    id              BIGSERIAL PRIMARY KEY,
    product_id      TEXT          NOT NULL,
    delivery_period TEXT          NOT NULL DEFAULT '现货',
    price           NUMERIC(18,4) NOT NULL,
    volume          NUMERIC(18,4) DEFAULT 0,
    turnover        NUMERIC(18,4) DEFAULT 0,
    change_percent  NUMERIC(10,4) DEFAULT 0,
    direction       TEXT          DEFAULT '',   -- up/down/neutral
    source          TEXT          NOT NULL DEFAULT 'platform',
    snapshot_time   TIMESTAMPTZ   NOT NULL,     -- 快照时间
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_unique
    ON snapshots (product_id, delivery_period, snapshot_time, source);

CREATE INDEX IF NOT EXISTS idx_snapshots_lookup
    ON snapshots (product_id, delivery_period, snapshot_time DESC);

CREATE INDEX IF NOT EXISTS idx_snapshots_time
    ON snapshots (snapshot_time DESC);

COMMENT ON TABLE snapshots IS '行情快照数据，由 crawler 定时采集写入';
COMMENT ON COLUMN snapshots.price IS '最新价';
COMMENT ON COLUMN snapshots.change_percent IS '涨跌幅 %';
COMMENT ON COLUMN snapshots.snapshot_time IS '快照采集时间 (UTC)';
