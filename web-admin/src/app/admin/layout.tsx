"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/lib/auth-store";
import { goAdminAuth } from "@/lib/paths";
import {
  LayoutDashboard,
  Package,
  BookOpen,
  Calendar,
  Settings,
  Clock,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
} from "lucide-react";

const navItems = [
  { href: "/admin", label: "总览", icon: LayoutDashboard },
  { href: "/admin/products", label: "品种管理", icon: Package },
  { href: "/admin/dict", label: "字典表管理", icon: BookOpen },
  { href: "/admin/holidays", label: "节假日管理", icon: Calendar },
  { href: "/admin/market-config", label: "市场配置", icon: Settings },
  { href: "/admin/cron-tasks", label: "定时任务", icon: Clock },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user, isAuthenticated, logout } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = (localStorage.getItem("admin_theme") as "light" | "dark") || "light";
    setTheme(saved);
    document.documentElement.setAttribute("data-theme", saved);
  }, []);

  useEffect(() => {
    if (mounted && !isAuthenticated) {
      goAdminAuth();
    }
  }, [mounted, isAuthenticated]);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("admin_theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  const handleLogout = () => {
    logout();
    goAdminAuth();
  };

  if (!mounted || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-t-bg">
        <div className="animate-spin h-8 w-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const displayName = user?.company_name || user?.username || user?.email || "管理员";

  return (
    <div className="min-h-screen bg-t-bg flex">
      <aside
        className={`bg-t-card border-r border-t-border flex flex-col transition-all duration-200 relative ${
          collapsed ? "w-16" : "w-56"
        }`}
      >
        <div className="h-14 flex items-center border-b border-t-border px-4">
          {collapsed ? (
            <span className="text-brand-600 font-bold text-lg">禾</span>
          ) : (
            <span className="text-t-text font-bold text-base whitespace-nowrap">
              禾合 · 管理后台
            </span>
          )}
        </div>

        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-brand-500/10 text-brand-600 font-medium"
                    : "text-t-secondary hover:bg-t-hover hover:text-t-text"
                }`}
                title={collapsed ? item.label : undefined}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-t-border p-3 space-y-2">
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-t-secondary hover:bg-t-hover hover:text-t-text transition-colors"
            title={collapsed ? (theme === "light" ? "暗色模式" : "亮色模式") : undefined}
          >
            {theme === "light" ? (
              <Moon className="w-5 h-5 shrink-0" />
            ) : (
              <Sun className="w-5 h-5 shrink-0" />
            )}
            {!collapsed && (theme === "light" ? "暗色模式" : "亮色模式")}
          </button>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-t-secondary hover:bg-t-hover hover:text-red-500 transition-colors"
            title={collapsed ? "退出登录" : undefined}
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {!collapsed && <span>退出登录</span>}
          </button>
        </div>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute bottom-20 -right-3 w-6 h-6 bg-t-card border border-t-border rounded-full flex items-center justify-center text-t-muted hover:text-t-text transition-colors shadow-sm"
        >
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronLeft className="w-3.5 h-3.5" />
          )}
        </button>
      </aside>

      <main className="flex-1 overflow-auto">
        <header className="h-14 border-b border-t-border bg-t-card flex items-center justify-between px-6 sticky top-0 z-10">
          <div className="text-sm text-t-muted" />
          <div className="flex items-center gap-3">
            <span className="text-sm text-t-secondary">{displayName}</span>
            <span className="status-badge active text-xs px-2 py-0.5">管理员</span>
          </div>
        </header>

        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
