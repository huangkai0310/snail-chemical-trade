"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchProducts, fetchLatestPrice } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import type { LatestPriceResponse } from "@/lib/types";
import { useState, useEffect } from "react";

function PriceWidget({ productId }: { productId: string }) {
  const { data, isLoading } = useQuery<LatestPriceResponse>({
    queryKey: ["latestPrice", productId],
    queryFn: () => fetchLatestPrice(productId),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  if (isLoading) {
    return <span className="text-t-text-3 text-xs">加载中...</span>;
  }

  const isUp = (data?.change_pct ?? 0) >= 0;
  return (
    <span className="text-xs">
      {data?.latest != null && data.latest > 0 ? (
        <>
          <span className="font-mono text-t-text">
            ¥{data.latest.toLocaleString()}
          </span>
          <span className={`ml-1.5 ${isUp ? "text-trade-up" : "text-trade-down"}`}>
            {isUp ? "+" : ""}{data?.change_pct?.toFixed(2) ?? "0.00"}%
          </span>
        </>
      ) : (
        <span className="text-t-text-3">暂无报价</span>
      )}
    </span>
  );
}

export default function Home() {
  const { isAuthenticated } = useAuthStore();

  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
    staleTime: 5 * 60 * 1000,
  });

  const products = productsQuery.data ?? [];

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 bg-t-bg min-h-[calc(100vh-2.75rem)]">
      {/* 欢迎区域 */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-t-text mb-2">
          化工交易平台
        </h1>
        <p className="text-sm text-t-text-2">
          化工产品量化交易撮合平台，数据驱动的化工大宗商品电子交易市场
        </p>
      </div>

      {/* 产品概览卡片 */}
      <h2 className="text-sm font-semibold text-t-text-2 mb-3 uppercase tracking-wide">
        市场行情
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {productsQuery.isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-t-card border border-t-border rounded-lg p-3 animate-pulse">
                <div className="h-4 bg-t-hover rounded w-12 mb-2" />
                <div className="h-5 bg-t-hover rounded w-20" />
              </div>
            ))
          : products.map((p) => (
              <div
                key={p.id}
                className="bg-t-card border border-t-border rounded-lg p-3 hover:border-t-border/70 transition-colors"
              >
                <div className="text-[10px] text-t-text-3 mb-1 uppercase tracking-wider">
                  {p.id}
                </div>
                <div className="text-sm font-semibold text-t-text mb-1.5">
                  {p.name}
                </div>
                <PriceWidget productId={p.id} />
              </div>
            ))}
      </div>

      {/* 快速入口 */}
      <h2 className="text-sm font-semibold text-t-text-2 mb-3 uppercase tracking-wide">
        快速入口
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          href={isAuthenticated ? "/trading" : "#"}
          onClick={(e) => {
            if (!isAuthenticated) e.preventDefault();
          }}
          className="block bg-t-card border border-t-border rounded-lg p-5 hover:border-trade-up/40 transition-all group"
        >
          <div className="w-10 h-10 rounded-lg bg-trade-up/10 flex items-center justify-center mb-3 group-hover:bg-trade-up/20 transition-colors">
            <svg className="w-5 h-5 text-trade-up" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-t-text mb-1">交易大厅</h3>
          <p className="text-xs text-t-text-3">
            {isAuthenticated ? "查看K线、盘口、挂牌、摘盘" : "请先登录"}
          </p>
        </Link>

        <Link
          href={isAuthenticated ? "/my" : "#"}
          onClick={(e) => {
            if (!isAuthenticated) e.preventDefault();
          }}
          className="block bg-t-card border border-t-border rounded-lg p-5 hover:border-brand-500/40 transition-all group"
        >
          <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center mb-3 group-hover:bg-brand-500/20 transition-colors">
            <svg className="w-5 h-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-t-text mb-1">我的交易</h3>
          <p className="text-xs text-t-text-3">
            {isAuthenticated ? "查看我的挂盘与成交记录" : "请先登录"}
          </p>
        </Link>

        <Link
          href={isAuthenticated ? "/counter-offers" : "#"}
          onClick={(e) => {
            if (!isAuthenticated) e.preventDefault();
          }}
          className="block bg-t-card border border-t-border rounded-lg p-5 hover:border-amber-400/40 transition-all group"
        >
          <div className="w-10 h-10 rounded-lg bg-amber-400/10 flex items-center justify-center mb-3 group-hover:bg-amber-400/20 transition-colors">
            <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-t-text mb-1">商谈管理</h3>
          <p className="text-xs text-t-text-3">
            {isAuthenticated ? "查看收到的和发出的商谈" : "请先登录"}
          </p>
        </Link>

        <Link
          href={isAuthenticated ? "/account" : "#"}
          onClick={(e) => {
            if (!isAuthenticated) e.preventDefault();
          }}
          className="block bg-t-card border border-t-border rounded-lg p-5 hover:border-amber-400/40 transition-all group"
        >
          <div className="w-10 h-10 rounded-lg bg-amber-400/10 flex items-center justify-center mb-3 group-hover:bg-amber-400/20 transition-colors">
            <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-t-text mb-1">资金账户</h3>
          <p className="text-xs text-t-text-3">
            {isAuthenticated ? "查看余额、保证金、资金流水" : "请先登录"}
          </p>
        </Link>
      </div>
    </main>
  );
}
