-- 055_admin_user_seed.sql
-- 创建量化管理后台初始管理员账号
-- 幂等：使用 ON CONFLICT (username) DO NOTHING 确保重复执行不报错
--
-- 管理员登录信息：
--   用户名：admin
--   密码：admin123

INSERT INTO users (username, password_hash, role, status, created_at, updated_at)
VALUES (
    'admin',
    '$2b$10$bUfIEpPAoT1ige3ViXKJke2yu0Lf2kiijnqdNIP4P/2AVk/x6kQqm',
    'admin',
    'active',
    NOW(),
    NOW()
)
ON CONFLICT (username) DO NOTHING;
