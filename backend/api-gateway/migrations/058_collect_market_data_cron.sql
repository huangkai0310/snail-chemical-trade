-- 058_collect_market_data_cron.sql
-- 数据采集定时任务 seed（每 1 小时采集一次平台行情数据）
-- 幂等：ON CONFLICT (name) DO NOTHING

INSERT INTO cron_tasks (name, description, task_type, interval_seconds, enabled)
VALUES (
    'collect_market_data',
    '定时采集平台行情数据 -> ohlcv_bars + snapshot 本地仓库',
    'interval',
    3600,
    true
)
ON CONFLICT (name) DO NOTHING;
