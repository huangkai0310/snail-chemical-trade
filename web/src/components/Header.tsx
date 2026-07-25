"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";
import { fetchMe } from "@/lib/api";
import { useTheme } from "@/lib/theme-provider";
import { useNotificationStore } from "@/lib/notification-store";
import {
  getSoundPrefs,
  loadSoundPrefsFromLocal,
  playNotificationSound,
  unlockAudio,
  type SoundPrefs,
} from "@/lib/sound-prefs";
import { persistSoundPrefs } from "./PreferencesSync";
import AuthModal from "./AuthModal";
import NotificationPanel from "./NotificationPanel";

export default function Header() {
  const { user, isAuthenticated, logout } = useAuthStore();
  const { theme, toggleTheme } = useTheme();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [ready, setReady] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const [soundPrefs, setSoundPrefs] = useState<SoundPrefs>(() => loadSoundPrefsFromLocal());
  const pathname = usePathname();

  // 初始化用户信息
  useEffect(() => {
    const token = useAuthStore.getState().token;
    if (!token) {
      setReady(true);
      return;
    }
    fetchMe()
      .then((me) => {
        useAuthStore.getState().setAuth(token, me);
      })
      .catch(() => {
        logout();
      })
      .finally(() => setReady(true));
  }, [logout]);

  useEffect(() => {
    const sync = () => setSoundPrefs(getSoundPrefs());
    window.addEventListener("sound-prefs-changed", sync);
    return () => window.removeEventListener("sound-prefs-changed", sync);
  }, []);

  const openAuth = useCallback((mode: "login" | "register") => {
    setAuthMode(mode);
    setAuthOpen(true);
  }, []);

  const patchSound = useCallback((patch: Partial<SoundPrefs>) => {
    const next = { ...getSoundPrefs(), ...patch };
    persistSoundPrefs(next);
    setSoundPrefs(next);
    unlockAudio();
  }, []);

  const displayName = user?.company_name || user?.username || "";

  return (
    <>
      <header className="bg-t-panel border-b border-t-border sticky top-0 z-40 h-11 flex items-center">
        <div className="w-full px-3 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-trade-up flex items-center justify-center text-white font-bold text-xs">
              S
            </div>
            <span className="font-semibold text-t-text text-sm">Snail Chemical</span>
            <span className="text-[10px] text-t-text-3 bg-t-hover px-1.5 py-0.5 rounded hidden sm:inline">
              PRO
            </span>
          </div>

          {/* Nav + Auth */}
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-3 text-xs">
              <Link
                href="/"
                className={`transition-colors ${pathname === "/" || pathname === "/index.html" ? "text-t-text font-medium" : "text-t-text-2 hover:text-t-text"}`}
              >
                首页
              </Link>
              <Link
                href="/quant"
                className={`transition-colors ${pathname === "/quant" || pathname === "/quant.html" ? "text-t-text font-medium" : "text-t-text-2 hover:text-t-text"}`}
              >
                量化分析
              </Link>
              {isAuthenticated && (
                <Link
                  href="/trading"
                  className={`transition-colors ${pathname === "/trading" || pathname === "/trading.html" ? "text-t-text font-medium" : "text-t-text-2 hover:text-t-text"}`}
                >
                  交易大厅
                </Link>
              )}
            </div>

            {/* Auth buttons / User dropdown */}
            <div className="flex items-center gap-2 text-xs">
              {!ready ? (
                <>
                  <button
                    onClick={() => openAuth("login")}
                    className="px-3 py-1 text-t-text-2 hover:text-t-text rounded transition-colors"
                  >
                    登录
                  </button>
                  <button
                    onClick={() => openAuth("register")}
                    className="px-3 py-1 bg-brand-600 hover:bg-brand-700 text-white rounded transition-colors"
                  >
                    注册
                  </button>
                </>
              ) : isAuthenticated && user ? (
                <div className="flex items-center gap-1">
                  {/* 常驻铃铛通知按钮 */}
                  <button
                    onClick={() => setNotifPanelOpen(true)}
                    className="relative p-1.5 rounded text-t-text-2 hover:text-t-text hover:bg-t-hover transition-colors"
                    title="消息通知"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.097 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                    </svg>
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] flex items-center justify-center bg-red-500 text-white text-[9px] rounded-full px-1 font-medium leading-none shadow-sm">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </button>

                  <div className="relative">
                  {/* 账号按钮 + 未读角标（角标在账号外面） */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDropdownOpen((v) => !v);
                    }}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
                      dropdownOpen
                        ? "bg-t-hover text-t-text"
                        : "text-t-text-2 hover:text-t-text hover:bg-t-hover"
                    }`}
                  >
                    <span className="text-sm">{displayName}</span>
                    <svg
                      className={`w-3 h-3 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>

                  {/* 下拉菜单 — 使用 fixed 遮罩 + absolute 菜单 */}
                  {dropdownOpen && (
                    <>
                      {/* 全屏透明遮罩，点击关闭下拉 */}
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setDropdownOpen(false)}
                      />
                      {/* 下拉菜单 */}
                      <div className="absolute right-0 top-full mt-1 w-44 bg-t-panel border border-t-border rounded-lg shadow-xl z-50 py-1">
                        {/* 个人中心 */}
                        <Link
                          href="/profile"
                          onClick={() => setDropdownOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 text-t-text-2 hover:text-t-text hover:bg-t-hover transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                          </svg>
                          个人中心
                        </Link>
                        <Link
                          href="/quant"
                          onClick={() => setDropdownOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 text-t-text-2 hover:text-t-text hover:bg-t-hover transition-colors md:hidden"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                          </svg>
                          量化分析
                        </Link>
                        {/* 我的交易 */}
                        <Link
                          href="/my"
                          onClick={() => setDropdownOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 text-t-text-2 hover:text-t-text hover:bg-t-hover transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
                          </svg>
                          我的交易
                        </Link>
                        <Link
                          href="/counter-offers"
                          onClick={() => setDropdownOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 text-t-text-2 hover:text-t-text hover:bg-t-hover transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                          </svg>
                          商谈管理
                        </Link>
                        <Link
                          href="/account"
                          onClick={() => setDropdownOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 text-t-text-2 hover:text-t-text hover:bg-t-hover transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                          </svg>
                          资金账户
                        </Link>
                        <button
                          onClick={() => {
                            setNotifPanelOpen(true);
                            setDropdownOpen(false);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-t-text-2 hover:text-t-text hover:bg-t-hover transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.097 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                          </svg>
                          消息
                          {unreadCount > 0 && (
                            <span className="ml-auto text-[10px] bg-red-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center font-medium leading-none">
                              {unreadCount > 99 ? "99+" : unreadCount}
                            </span>
                          )}
                        </button>

                        {/* 分隔线 */}
                        <div className="border-t border-t-border my-1" />

                        {/* 设置 — 主题切换 */}
                        <button
                          onClick={() => {
                            toggleTheme();
                            setDropdownOpen(false);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-t-text-2 hover:text-t-text hover:bg-t-hover transition-colors"
                        >
                          {theme === "dark" ? (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                            </svg>
                          )}
                          切换界面颜色
                        </button>

                        {/* 铃声设置 */}
                        <div className="px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-t-text-2 text-sm">提示铃声</span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={soundPrefs.enabled}
                              onClick={() => {
                                const next = !soundPrefs.enabled;
                                patchSound({ enabled: next });
                                if (next) playNotificationSound();
                              }}
                              className={`relative w-9 h-5 rounded-full transition-colors ${
                                soundPrefs.enabled ? "bg-brand-600" : "bg-t-border"
                              }`}
                            >
                              <span
                                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                                  soundPrefs.enabled ? "translate-x-4" : ""
                                }`}
                              />
                            </button>
                          </div>
                        </div>

                        {/* 分隔线 */}
                        <div className="border-t border-t-border my-1" />

                        {/* 切换账号 — 退出并直接打开登录界面（含已保存账号） */}
                        <button
                          onClick={() => {
                            logout();
                            setAuthMode("login");
                            setAuthOpen(true);
                            setDropdownOpen(false);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-t-text-2 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                          </svg>
                          切换账号
                        </button>
                      </div>
                    </>
                  )}
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => openAuth("login")}
                    className="px-3 py-1 text-t-text-2 hover:text-t-text rounded transition-colors"
                  >
                    登录
                  </button>
                  <button
                    onClick={() => openAuth("register")}
                    className="px-3 py-1 bg-brand-600 hover:bg-brand-700 text-white rounded transition-colors"
                  >
                    注册
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <AuthModal
        open={authOpen}
        initialMode={authMode}
        onClose={() => setAuthOpen(false)}
      />

      <NotificationPanel
        open={notifPanelOpen}
        onClose={() => setNotifPanelOpen(false)}
      />
    </>
  );
}
