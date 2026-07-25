-- 053_market_config.sql
-- 市场配置表：全局闭市开关 + cron 定时任务配置
-- 替代 main.go 中硬编码的定时任务间隔

CREATE TABLE IF NOT EXISTS market_config (
    key VARCHAR(64) PRIMARY KEY,
    value TEXT NOT NULL,
    description VARCHAR(256),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 市场开闭状态
INSERT INTO market_config (key, value, description) VALUES
    ('market_open', 'true', '市场是否开市（true=开市/false=闭市）'),
    ('market_close_reason', '', '闭市原因（如节假日、维护等）'),
    -- 过期挂牌清理间隔（秒）
    ('expire_listings_interval', '60', '过期挂牌清理检查间隔（秒）'),
    -- 过期议价清理时间（HH:MM）
    ('expire_counter_offers_time', '00:05', '过期议价清理执行时间（每天）'),
    -- 定时挂牌激活检查间隔（秒）
    ('activate_scheduled_interval', '60', '定时挂牌激活检查间隔（秒）'),
    -- 定时提醒检查间隔（秒）
    ('schedule_reminders_interval', '60', '定时提醒检查间隔（秒）')
ON CONFLICT (key) DO NOTHING;

-- ========== Cron 任务配置表 ==========
-- 用于管理后台配置和触发定时任务
CREATE TABLE IF NOT EXISTS cron_tasks (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL UNIQUE,
    description VARCHAR(256),
    task_type VARCHAR(64) NOT NULL DEFAULT 'interval',
    interval_seconds INT,
    cron_expr VARCHAR(64),
    enabled BOOLEAN NOT NULL DEFAULT true,
    last_run_at TIMESTAMPTZ,
    last_status VARCHAR(32) DEFAULT 'idle',
    last_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 从 main.go 迁移的定时任务
INSERT INTO cron_tasks (name, description, task_type, interval_seconds, enabled) VALUES
    ('expire_listings', '过期挂牌清理', 'interval', 60, true),
    ('expire_swaps', '过期换盘清理', 'interval', 60, true),
    ('activate_scheduled', '定时挂牌/换盘激活', 'interval', 60, true),
    ('schedule_reminders', '定时提醒推送', 'interval', 60, true),
    ('expire_counter_offers', '过期议价清理', 'cron', NULL, true)
ON CONFLICT (name) DO NOTHING;

-- 为过期议价任务设置 cron 表达式
UPDATE cron_tasks SET cron_expr = '5 0 * * *'
WHERE name = 'expire_counter_offers' AND cron_expr IS NULL;
