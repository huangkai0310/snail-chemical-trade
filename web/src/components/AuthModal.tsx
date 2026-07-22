"use client";

import { useState, useEffect } from "react";
import { login, register, fetchMe, ApiError } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import {
  getSavedAccounts,
  upsertSavedAccount,
  removeSavedAccount,
  type SavedAccount,
} from "@/lib/accounts";
import { validateUsername, validatePassword, isSafeInput, sanitizeText } from "@/lib/validate";

type Mode = "login" | "register";

interface Props {
  open: boolean;
  initialMode?: Mode;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function AuthModal({
  open,
  initialMode = "login",
  onClose,
  onSuccess,
}: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 随机化字段名，每次打开都重新生成，阻止浏览器根据固定 name/autocomplete 自动填充
  // （避免"切换账号"时被上一个账号如 admin 的凭据自动占据，导致无法登录其它账号）
  const [formNonce, setFormNonce] = useState(() => Math.random().toString(36).slice(2, 10));
  // 已保存账号
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      // 每次打开都重新生成 nonce + 清空输入，确保不残留上一次输入，也避免浏览器自动填充命中
      setFormNonce(Math.random().toString(36).slice(2, 10));
      setUsername("");
      setPassword("");
      setConfirm("");
      setError(null);
      const accs = getSavedAccounts();
      setSavedAccounts(accs);
      // 登录模式且有已保存账号时，默认展示"一键切换"列表（完全不经过浏览器自动填充）
      setShowPicker(initialMode === "login" && accs.length > 0);
    }
  }, [open, initialMode]);

  if (!open) return null;

  const resetForm = () => {
    setUsername("");
    setPassword("");
    setConfirm("");
    setError(null);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setShowPicker(next === "login" && savedAccounts.length > 0);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // 点击已保存账号 -> 直接用保存的 token 恢复登录（不经过浏览器自动填充）
  const handleSwitchAccount = async (acc: SavedAccount) => {
    setError(null);
    setLoading(true);
    try {
      // 先恢复登录态
      useAuthStore.getState().setAuth(acc.token, acc.user);
      // 再向后端校验 token 是否仍然有效
      const me = await fetchMe();
      useAuthStore.getState().setAuth(acc.token, me);
      // 刷新最近登录时间（置顶）
      upsertSavedAccount(me, acc.token);
      onSuccess?.();
      onClose();
    } catch {
      // token 已失效：移除该记录并退回手动登录
      removeSavedAccount(acc.username);
      const accs = getSavedAccounts();
      setSavedAccounts(accs);
      setShowPicker(false);
      setError("该账号登录已失效，请重新输入密码登录");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (usernameToRemove: string) => {
    removeSavedAccount(usernameToRemove);
    const accs = getSavedAccounts();
    setSavedAccounts(accs);
    if (accs.length === 0) setShowPicker(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "register") {
      if (password !== confirm) {
        setError("两次输入的密码不一致");
        return;
      }
      const pwdCheck = validatePassword(password);
      if (!pwdCheck.valid) {
        setError(pwdCheck.error!);
        return;
      }
      const nameCheck = validateUsername(username);
      if (!nameCheck.valid) {
        setError(nameCheck.error!);
        return;
      }
    }
    // 登录和注册都检查输入安全性
    if (!isSafeInput(username) || !isSafeInput(password)) {
      setError("输入包含非法字符");
      return;
    }

    setLoading(true);
    try {
      if (mode === "login") {
        await login({ username, password });
      } else {
        await register({ username, password });
      }
      resetForm();
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  const displayNameOf = (acc: SavedAccount) =>
    acc.user.company_name || acc.user.username;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative bg-white dark:bg-t-panel rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-t-border">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => switchMode("login")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                mode === "login"
                  ? "bg-brand-600 text-white"
                  : "text-gray-500 dark:text-t-text-2 hover:bg-gray-100 dark:hover:bg-t-hover"
              }`}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => switchMode("register")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                mode === "register"
                  ? "bg-brand-600 text-white"
                  : "text-gray-500 dark:text-t-text-2 hover:bg-gray-100 dark:hover:bg-t-hover"
              }`}
            >
              注册
            </button>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-t-text text-xl leading-none p-1"
          >
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          {/* ========== 已保存账号：一键切换 ========== */}
          {showPicker && mode === "login" ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 dark:text-t-text-2">
                选择一个已登录的账号直接切换
              </p>
              <div className="space-y-2">
                {savedAccounts.map((acc) => (
                  <div
                    key={acc.username}
                    className="flex items-center gap-3 p-3 border border-gray-200 dark:border-t-border rounded-lg hover:border-brand-500 transition-colors"
                  >
                    <div className="w-9 h-9 shrink-0 rounded-full bg-brand-600 text-white flex items-center justify-center font-medium text-sm">
                      {(displayNameOf(acc)[0] || "?").toUpperCase()}
                    </div>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleSwitchAccount(acc)}
                      className="flex-1 min-w-0 text-left disabled:opacity-50"
                    >
                      <div className="text-sm font-medium text-t-text truncate">
                        {displayNameOf(acc)}
                      </div>
                      <div className="text-xs text-t-text-2 truncate">
                        @{acc.username}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(acc.username)}
                      title="删除该账号记录"
                      className="shrink-0 text-gray-400 hover:text-red-500 p-1 text-sm leading-none"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowPicker(false);
                  setError(null);
                }}
                className="w-full py-2 text-sm text-brand-600 hover:text-brand-700 font-medium rounded-lg hover:bg-brand-50 dark:hover:bg-brand-600/10 transition-colors"
              >
                使用其他账号登录
              </button>
            </div>
          ) : (
            /* ========== 手动登录 / 注册表单 ========== */
            <form
              key={formNonce}
              onSubmit={handleSubmit}
              className="space-y-4"
              autoComplete="off"
            >
              {/* 诱饵字段：吸走浏览器的自动填充，避免填入真实输入框 */}
              <input
                type="text"
                name="username"
                autoComplete="username"
                tabIndex={-1}
                aria-hidden="true"
                style={{ position: "absolute", opacity: 0, height: 0, width: 0, pointerEvents: "none" }}
              />
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                tabIndex={-1}
                aria-hidden="true"
                style={{ position: "absolute", opacity: 0, height: 0, width: 0, pointerEvents: "none" }}
              />

              {mode === "login" && savedAccounts.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowPicker(true);
                    setError(null);
                  }}
                  className="text-xs text-brand-600 hover:text-brand-700"
                >
                  ← 选择已保存账号
                </button>
              )}

              <p className="text-sm text-gray-500 dark:text-t-text-2">
                {mode === "login"
                  ? "登录后即可发布挂牌、摘盘交易"
                  : "注册企业账号，参与化工现货交易"}
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-t-text-2 mb-1.5">
                  用户名
                </label>
                <input
                  type="text"
                  name={`user_${formNonce}`}
                  value={username}
                  onChange={(e) => setUsername(sanitizeText(e.target.value))}
                  placeholder="3-64 个字符"
                  required
                  minLength={3}
                  maxLength={64}
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-t-border dark:bg-t-input dark:text-t-text rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-t-text-2 mb-1.5">
                  密码
                </label>
                <input
                  type="password"
                  name={`pwd_${formNonce}`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "register" ? "至少 6 位" : "请输入密码"}
                  required
                  minLength={mode === "register" ? 6 : 1}
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-t-border dark:bg-t-input dark:text-t-text rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              {mode === "register" && (
                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-t-text-2 mb-1.5">
                    确认密码
                  </label>
                  <input
                    type="password"
                    name={`confirm_${formNonce}`}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="再次输入密码"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-t-border dark:bg-t-input dark:text-t-text rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg text-sm text-red-700 dark:text-red-400">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
              >
                {loading ? "处理中..." : mode === "login" ? "登录" : "注册"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
