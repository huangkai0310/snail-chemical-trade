"use client";

import React, { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui";
import { productApi, marketConfigApi, cronTaskApi } from "@/lib/api";
import { Package, TrendingUp, AlertCircle, CheckCircle, Clock } from "lucide-react";

export default function DashboardPage() {
  const [stats, setStats] = useState({
    products: 0,
    marketOpen: true,
    cronEnabled: 0,
    cronTotal: 0,
    loading: true,
    error: "",
  });

  useEffect(() => {
    Promise.all([productApi.list(), marketConfigApi.getMarketStatus(), cronTaskApi.list()])
      .then(([productsRes, statusRes, cronRes]) => {
        const tasks = cronRes.data || [];
        setStats({
          products: productsRes.data?.length ?? 0,
          marketOpen: statusRes.market_open ?? true,
          cronEnabled: tasks.filter((t) => t.enabled).length,
          cronTotal: tasks.length,
          loading: false,
          error: "",
        });
      })
      .catch((err: Error) => {
        setStats((s) => ({ ...s, loading: false, error: err.message }));
      });
  }, []);

  if (stats.loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="总览" description="量化交易平台管理后台" />

      {stats.error && (
        <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-600 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {stats.error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 品种数量 */}
        <div className="bg-t-card border border-t-border rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-brand-500/10 rounded-lg">
              <Package className="w-5 h-5 text-brand-600" />
            </div>
            <span className="text-sm text-t-muted">品种数量</span>
          </div>
          <p className="text-2xl font-bold text-t-text">{stats.products}</p>
        </div>

        {/* 市场状态 */}
        <div className="bg-t-card border border-t-border rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className={`p-2 rounded-lg ${stats.marketOpen ? "bg-green-500/10" : "bg-red-500/10"}`}>
              {stats.marketOpen ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600" />
              )}
            </div>
            <span className="text-sm text-t-muted">市场状态</span>
          </div>
          <p className={`text-2xl font-bold ${stats.marketOpen ? "text-green-600" : "text-red-600"}`}>
            {stats.marketOpen ? "开市" : "休市"}
          </p>
        </div>

        {/* 定时任务 */}
        <div className="bg-t-card border border-t-border rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-sm text-t-muted">定时任务</span>
          </div>
          <p className="text-2xl font-bold text-t-text">
            {stats.cronEnabled}
            <span className="text-sm font-normal text-t-muted"> / {stats.cronTotal} 启用</span>
          </p>
        </div>

        {/* 数据源状态 */}
        <div className="bg-t-card border border-t-border rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
            </div>
            <span className="text-sm text-t-muted">快捷入口</span>
          </div>
          <p className="text-base font-medium text-t-text">
            <a href="/admin/cron-tasks" className="text-brand-600 hover:underline">
              任务管理 →
            </a>
          </p>
        </div>
      </div>

      <div className="mt-6 bg-t-card border border-t-border rounded-xl p-5">
        <h3 className="text-sm font-medium text-t-text mb-4">快捷入口</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { label: "品种管理", href: "/admin/products" },
            { label: "字典表", href: "/admin/dict" },
            { label: "节假日", href: "/admin/holidays" },
            { label: "市场配置", href: "/admin/market-config" },
            { label: "定时任务", href: "/admin/cron-tasks" },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="px-4 py-3 bg-t-panel border border-t-border rounded-lg text-sm text-t-secondary hover:text-t-text hover:bg-t-hover transition-colors text-center"
            >
              {item.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
