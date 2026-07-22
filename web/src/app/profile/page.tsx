"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/auth-store";
import { useRouter } from "next/navigation";
import { fetchMe } from "@/lib/api";
import type { User } from "@/lib/types";

export default function ProfilePage() {
  const { isAuthenticated, user: storeUser, token } = useAuthStore();
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/");
      return;
    }
    fetchMe()
      .then((data) => setMe(data))
      .catch((err) => setError(err.message || "获取用户信息失败"))
      .finally(() => setLoading(false));
  }, [isAuthenticated, router, token]);

  if (!isAuthenticated) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-12 text-center text-t-text-3">
        请先登录
      </main>
    );
  }

  const profile = me || storeUser;

  const roleMap: Record<string, string> = {
    trader: "交易员",
    admin: "管理员",
    operator: "运营",
  };

  const statusMap: Record<string, { label: string; color: string }> = {
    active: { label: "正常", color: "text-trade-up" },
    inactive: { label: "未激活", color: "text-t-text-3" },
    suspended: { label: "已封禁", color: "text-red-500" },
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <main className="max-w-3xl mx-auto px-4 py-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-t-text">个人中心</h1>
        <span className="text-sm text-t-text-3">{profile?.username}</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-t-text-3 text-sm">
          加载中...
        </div>
      ) : error ? (
        <div className="text-center py-20 text-red-500 text-sm">{error}</div>
      ) : (
        <>
          {/* 用户卡片 */}
          <div className="bg-t-panel border border-t-border rounded-xl p-6 mb-4">
            <div className="flex items-center gap-4 mb-6">
              {/* 头像 */}
              <div className="w-16 h-16 rounded-full bg-brand-600 flex items-center justify-center text-white text-2xl font-bold shrink-0">
                {(profile?.company_name || profile?.username || "?").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-lg font-semibold text-t-text truncate">
                  {profile?.company_name || profile?.username || "-"}
                </div>
                <div className="text-sm text-t-text-3 truncate">
                  @{profile?.username || "-"}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-t-hover text-t-text-2">
                    {roleMap[profile?.role || ""] || profile?.role || "-"}
                  </span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs bg-t-hover ${statusMap[profile?.status || ""]?.color || "text-t-text-2"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full mr-1 ${profile?.status === "active" ? "bg-trade-up" : profile?.status === "suspended" ? "bg-red-500" : "bg-t-text-3"}`} />
                    {statusMap[profile?.status || ""]?.label || profile?.status || "-"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 基本信息表格 */}
          <div className="bg-t-panel border border-t-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-t-border">
              <h2 className="text-sm font-semibold text-t-text">基本信息</h2>
            </div>
            <div className="divide-y divide-t-border">
              {/* 用户 ID (UUID) 全宽展示，支持点击选中复制 */}
              <div className="px-5 py-3">
                <div className="text-sm text-t-text-3 mb-1">用户 ID (UUID)</div>
                <div className="text-xs text-t-text font-mono break-all select-all">{profile?.id || "-"}</div>
              </div>
              <InfoRow label="用户名" value={profile?.username || "-"} />
              <InfoRow label="公司名称" value={profile?.company_name || "-"} />
              <InfoRow label="邮箱" value={profile?.email || "-"} />
              <InfoRow label="手机" value={profile?.phone || "-"} />
              <InfoRow label="账号角色" value={roleMap[profile?.role || ""] || profile?.role || "-"} />
              <InfoRow label="账号状态" value={statusMap[profile?.status || ""]?.label || profile?.status || "-"} />
              <InfoRow label="注册时间" value={formatDate(profile?.created_at)} />
              <InfoRow label="更新时间" value={formatDate(profile?.updated_at)} />
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-sm text-t-text-3">{label}</span>
      <span className="text-sm text-t-text font-medium">{value}</span>
    </div>
  );
}
