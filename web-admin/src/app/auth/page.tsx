"use client";

import React, { useEffect, useState } from "react";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { goAdminHome } from "@/lib/paths";

export default function AuthPage() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  // 已登录管理员直接进入后台
  useEffect(() => {
    setReady(true);
    if (isAuthenticated && user?.role === "admin") {
      goAdminHome();
    }
  }, [isAuthenticated, user]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await authApi.login(username.trim(), password);
      if (res.user.role !== "admin") {
        useAuthStore.getState().logout();
        setError("该账号没有管理员权限");
        return;
      }
      setAuth(res.token, res.user);
      goAdminHome();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "登录失败，请重试";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!ready) {
    return <div className="auth-shell" aria-hidden />;
  }

  return (
    <div className="auth-shell">
      {/* 全幅氛围底：钢青工业色，非卡片堆叠 */}
      <div className="auth-atmosphere" aria-hidden>
        <div className="auth-atmosphere__wash" />
        <div className="auth-atmosphere__grid" />
        <div className="auth-atmosphere__beam" />
      </div>

      <main className="auth-stage">
        {/* 品牌区：首屏主视觉信号 */}
        <header className="auth-brand">
          <div className="auth-brand__mark" aria-hidden>
            <span>禾</span>
          </div>
          <h1 className="auth-brand__name">禾合</h1>
          <p className="auth-brand__en">ChemBridge Admin</p>
          <p className="auth-brand__tag">量化交易管理后台</p>
        </header>

        {/* 登录交互区 */}
        <form className="auth-form" onSubmit={handleLogin} noValidate>
          {error && (
            <div className="auth-alert" role="alert">
              {error}
            </div>
          )}

          <label className="auth-field">
            <span className="auth-field__label">用户名</span>
            <input
              id="username"
              name="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="auth-field__input"
              placeholder="管理员账号"
              required
              autoComplete="username"
              autoFocus
              disabled={loading}
            />
          </label>

          <label className="auth-field">
            <span className="auth-field__label">密码</span>
            <div className="auth-field__row">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="auth-field__input"
                placeholder="登录密码"
                required
                autoComplete="current-password"
                disabled={loading}
              />
              <button
                type="button"
                className="auth-field__toggle"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? "隐藏" : "显示"}
              </button>
            </div>
          </label>

          <button type="submit" className="auth-submit" disabled={loading || !username || !password}>
            {loading ? "验证中…" : "进入后台"}
          </button>
        </form>

        <footer className="auth-foot">
          <span>v1.0.0</span>
          <span aria-hidden>·</span>
          <span>仅限授权管理员</span>
          <span aria-hidden>·</span>
          <span>&copy; {new Date().getFullYear()} Snail Chemical</span>
        </footer>
      </main>
    </div>
  );
}
