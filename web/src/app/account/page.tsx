"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/lib/auth-store";
import { useRouter } from "next/navigation";
import AccountPanel from "@/components/AccountPanel";

export default function AccountPage() {
  const { isAuthenticated, user } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) router.push("/");
  }, [isAuthenticated, router]);

  if (!isAuthenticated) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-12 text-center text-gray-400">
        请先登录
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">资金账户</h1>
        <span className="text-sm text-gray-500">{user?.username}</span>
      </div>

      <div className="max-w-2xl">
        <AccountPanel />
      </div>
    </main>
  );
}
