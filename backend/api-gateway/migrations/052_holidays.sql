-- 052_holidays.sql
-- 节假日管理表：替代 calendar/china.go 中的硬编码数据
-- 支持年度节假日管理 + 调休工作日标记
-- 数据来源：国务院办公厅当年节假日安排通知

CREATE TABLE IF NOT EXISTS holidays (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    is_holiday BOOLEAN NOT NULL DEFAULT true,
    name VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
CREATE INDEX IF NOT EXISTS idx_holidays_is_holiday ON holidays(is_holiday);

-- ========== 2025年节假日种子数据 ==========
-- 来源：国办发明电〔2024〕12号
INSERT INTO holidays (date, is_holiday, name) VALUES
    -- 元旦
    ('2025-01-01', true, '元旦'),
    -- 春节
    ('2025-01-28', true, '春节'),
    ('2025-01-29', true, '春节'),
    ('2025-01-30', true, '春节'),
    ('2025-01-31', true, '春节'),
    ('2025-02-01', true, '春节'),
    ('2025-02-02', true, '春节'),
    ('2025-02-03', true, '春节'),
    ('2025-02-04', true, '春节'),
    -- 清明
    ('2025-04-04', true, '清明'),
    ('2025-04-05', true, '清明'),
    ('2025-04-06', true, '清明'),
    -- 劳动节
    ('2025-05-01', true, '劳动节'),
    ('2025-05-02', true, '劳动节'),
    ('2025-05-03', true, '劳动节'),
    ('2025-05-04', true, '劳动节'),
    ('2025-05-05', true, '劳动节'),
    -- 端午
    ('2025-05-31', true, '端午'),
    ('2025-06-01', true, '端午'),
    ('2025-06-02', true, '端午'),
    -- 国庆+中秋
    ('2025-10-01', true, '国庆'),
    ('2025-10-02', true, '国庆'),
    ('2025-10-03', true, '国庆'),
    ('2025-10-04', true, '国庆'),
    ('2025-10-05', true, '国庆'),
    ('2025-10-06', true, '国庆'),
    ('2025-10-07', true, '国庆'),
    ('2025-10-08', true, '国庆')
ON CONFLICT (date) DO NOTHING;

-- 2025年调休上班日
INSERT INTO holidays (date, is_holiday, name) VALUES
    ('2025-01-26', false, '春节调休'),
    ('2025-02-08', false, '春节调休'),
    ('2025-04-27', false, '劳动节调休'),
    ('2025-09-28', false, '国庆调休'),
    ('2025-10-11', false, '国庆调休')
ON CONFLICT (date) DO NOTHING;

-- ========== 2026年节假日种子数据 ==========
-- 来源：国办发明电〔2025〕7号
INSERT INTO holidays (date, is_holiday, name) VALUES
    -- 元旦
    ('2026-01-01', true, '元旦'),
    ('2026-01-02', true, '元旦'),
    ('2026-01-03', true, '元旦'),
    -- 春节
    ('2026-02-15', true, '春节'),
    ('2026-02-16', true, '春节'),
    ('2026-02-17', true, '春节'),
    ('2026-02-18', true, '春节'),
    ('2026-02-19', true, '春节'),
    ('2026-02-20', true, '春节'),
    ('2026-02-21', true, '春节'),
    ('2026-02-22', true, '春节'),
    ('2026-02-23', true, '春节'),
    -- 清明
    ('2026-04-04', true, '清明'),
    ('2026-04-05', true, '清明'),
    ('2026-04-06', true, '清明'),
    -- 劳动节
    ('2026-05-01', true, '劳动节'),
    ('2026-05-02', true, '劳动节'),
    ('2026-05-03', true, '劳动节'),
    ('2026-05-04', true, '劳动节'),
    ('2026-05-05', true, '劳动节'),
    -- 端午
    ('2026-06-19', true, '端午'),
    ('2026-06-20', true, '端午'),
    ('2026-06-21', true, '端午'),
    -- 中秋
    ('2026-09-25', true, '中秋'),
    ('2026-09-26', true, '中秋'),
    ('2026-09-27', true, '中秋'),
    -- 国庆
    ('2026-10-01', true, '国庆'),
    ('2026-10-02', true, '国庆'),
    ('2026-10-03', true, '国庆'),
    ('2026-10-04', true, '国庆'),
    ('2026-10-05', true, '国庆'),
    ('2026-10-06', true, '国庆'),
    ('2026-10-07', true, '国庆')
ON CONFLICT (date) DO NOTHING;

-- 2026年调休上班日
INSERT INTO holidays (date, is_holiday, name) VALUES
    ('2026-01-04', false, '元旦调休'),
    ('2026-02-14', false, '春节调休'),
    ('2026-02-28', false, '春节调休'),
    ('2026-05-09', false, '劳动节调休'),
    ('2026-09-20', false, '中秋调休'),
    ('2026-10-10', false, '国庆调休')
ON CONFLICT (date) DO NOTHING;
