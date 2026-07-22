-- 035: 用户操作偏好（自选 / 交易大厅记忆等）按账号服务端持久化
-- 无痕模式与跨设备登录均可恢复

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- ["benzene:现货", "propylene:2607上"]
    favorites JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- {"productId":"benzene","deliveryPeriod":"现货","marketType":"spot"}
    trading_view JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- favorites | overview
    watchlist_tab VARCHAR(32) NOT NULL DEFAULT 'overview',
    -- /trading /my ...
    last_route VARCHAR(128),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE user_preferences IS '用户界面偏好：自选品种、交易大厅状态等，随账号跨端同步';
