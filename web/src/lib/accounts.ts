"use client";

import type { User } from "./types";

const ACCOUNTS_KEY = "snailchem_accounts";
const MAX_ACCOUNTS = 5;

export interface SavedAccount {
  username: string;
  token: string;
  user: User;
  lastLoginAt: number;
}

/** 读取已保存账号，按最近登录时间倒序 */
export function getSavedAccounts(): SavedAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    const list: SavedAccount[] = raw ? JSON.parse(raw) : [];
    return list.sort((a, b) => b.lastLoginAt - a.lastLoginAt);
  } catch {
    return [];
  }
}

/** 登录/注册成功后写入（同一 username 去重置顶，最多保留 5 条） */
export function upsertSavedAccount(user: User, token: string): void {
  if (typeof window === "undefined") return;
  const list = getSavedAccounts().filter((a) => a.username !== user.username);
  list.unshift({ username: user.username, token, user, lastLoginAt: Date.now() });
  const trimmed = list.slice(0, MAX_ACCOUNTS);
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(trimmed));
}

/** 删除某个已保存账号 */
export function removeSavedAccount(username: string): void {
  if (typeof window === "undefined") return;
  const list = getSavedAccounts().filter((a) => a.username !== username);
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
}
