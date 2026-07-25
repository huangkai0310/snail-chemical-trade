-- 迁移 048: 创建 ohlcv_bars 表 (K线数据)
-- 幂等: 使用 IF NOT EXISTS

CREATE TABLE IF NOT EXISTS ohlcv_bars (
    id            BIGSERIAL PRIMARY KEY,
    time          TIMESTAMPTZ   NOT NULL,
    open          NUMERIC(18,4) NOT NULL,
    high          NUMERIC(18,4) NOT NULL,
    low           NUMERIC(18,4) NOT NULL,
    close         NUMERIC(18,4) NOT NULL,
    volume        NUMERIC(18,4) NOT NULL DEFAULT 0,
    turnover      NUMERIC(18,4) NOT NULL DEFAULT 0,
    product_id    TEXT          NOT NULL,
    delivery_period TEXT        NOT NULL DEFAULT '现货',
    interval      TEXT          NOT NULL DEFAULT '1d',
    source        TEXT          NOT NULL DEFAULT 'platform',
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 唯一约束: 同品种+交割期+周期+时间 只存一条
CREATE UNIQUE INDEX IF NOT EXISTS idx_ohlcv_bars_unique
    ON ohlcv_bars (product_id, delivery_period, interval, time, source);

-- 查询索引
CREATE INDEX IF NOT EXISTS idx_ohlcv_bars_lookup
    ON ohlcv_bars (product_id, delivery_period, interval, time);

CREATE INDEX IF NOT EXISTS idx_ohlcv_bars_time
    ON ohlcv_bars (time DESC);

COMMENT ON TABLE ohlcv_bars IS 'K线历史数据，由 crawler 定时采集写入';
COMMENT ON COLUMN ohlcv_bars.time IS 'K线起始时间 (UTC)';
COMMENT ON COLUMN ohlcv_bars.product_id IS '品种 ID';
COMMENT ON COLUMN ohlcv_bars.delivery_period IS '交割期';
COMMENT ON COLUMN ohlcv_bars.interval IS 'K线周期: 1m/5m/15m/30m/1h/2h/4h/1d/1w/1M';
COMMENT ON COLUMN ohlcv_bars.source IS '数据来源';
