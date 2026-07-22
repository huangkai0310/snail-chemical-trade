-- 018_user_blacklist.sql
-- 用户黑名单表：单向拉黑，A拉黑B后，A看得到B的发盘但不能成交

CREATE TABLE IF NOT EXISTS user_blacklist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, blocked_user_id),
    CHECK (user_id <> blocked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_blacklist_user ON user_blacklist(user_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_blocked ON user_blacklist(blocked_user_id);
