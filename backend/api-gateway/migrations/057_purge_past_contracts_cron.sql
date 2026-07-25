-- 057_purge_past_contracts_cron.sql
-- 交割已过合约定时清理（每天一次；现货永不清理）

INSERT INTO cron_tasks (name, description, task_type, interval_seconds, enabled)
VALUES (
    'purge_past_contracts',
    '清除交割日已过的非现货合约（并清理自选）',
    'interval',
    86400,
    true
)
ON CONFLICT (name) DO NOTHING;
