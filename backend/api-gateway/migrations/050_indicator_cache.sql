-- 迁移 050: 创建 indicator_cache 表 (指标缓存)
-- 幂等: 使用 IF NOT EXISTS

CREATE TABLE IF NOT EXISTS indicator_cache (
    id              BIGSERIAL PRIMARY KEY,
    product_id      TEXT          NOT NULL,
    delivery_period TEXT          NOT NULL DEFAULT '现货',
    interval        TEXT          NOT NULL DEFAULT '1d',
    indicator       TEXT          NOT NULL,     -- ma/ema/rsi/macd/boll/volume_ma 等
    params          JSONB         NOT NULL DEFAULT '{}',  -- 指标参数，如 {"period": 30}
    value           JSONB         NOT NULL,     -- 指标值，如 {"ma30": 1234.5, "trend": "up"}
    computed_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(), -- 计算时间
    data_through    TIMESTAMPTZ   NOT NULL,     -- 数据截止时间 (最近一根K线的 time)
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 每个指标参数组合只保留最新
CREATE UNIQUE INDEX IF NOT EXISTS idx_indicator_cache_unique
    ON indicator_cache (product_id, delivery_period, interval, indicator, params);

CREATE INDEX IF NOT EXISTS idx_indicator_cache_lookup
    ON indicator_cache (product_id, delivery_period, interval, indicator);

COMMENT ON TABLE indicator_cache IS '技术指标缓存，由计算服务写入';
COMMENT ON COLUMN indicator_cache.indicator IS '指标名称: ma/ema/rsi/macd/boll/volume_ma';
COMMENT ON COLUMN indicator_cache.params IS '指标参数 JSON，如 {"period": 30}';
COMMENT ON COLUMN indicator_cache.value IS '指标值 JSON，如 {"ma30": 1234.5, "trend": "up"}';
COMMENT ON COLUMN indicator_cache.data_through IS '数据截止时间 (最近一根K线的 time)';
