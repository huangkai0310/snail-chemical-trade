-- 054_cron_tasks_seed.sql
-- 向 cron_tasks 表插入默认定时任务配置
-- 幂等：使用 ON CONFLICT (name) DO NOTHING 确保重复执行不报错

-- 过期挂牌清理（每分钟执行）
INSERT INTO cron_tasks (name, description, task_type, interval_seconds, enabled)
VALUES (
    'expire_listings',
    '过期挂牌/换盘清理 + 预约挂牌/换盘自动发布 + 到期提醒',
    'interval',
    60,
    true
)
ON CONFLICT (name) DO NOTHING;

-- 过期议价清理（每天凌晨 00:05 执行，用 interval=86400 降级为每天）
INSERT INTO cron_tasks (name, description, task_type, interval_seconds, enabled)
VALUES (
    'expire_counter_offers',
    '过期待回复议价自动标记为 EXPIRED',
    'interval',
    86400,
    true
)
ON CONFLICT (name) DO NOTHING;
