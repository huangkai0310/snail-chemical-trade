"use client";

import React, { useEffect, useState, useCallback } from "react";
import { PageHeader, Panel, Button, Input } from "@/components/ui";
import { marketConfigApi } from "@/lib/api";
import type { MarketConfig, MarketStatus } from "@/lib/types";
import { AlertCircle, Power, PowerOff, Save, Trash2 } from "lucide-react";

export default function MarketConfigPage() {
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [configs, setConfigs] = useState<MarketConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [st, cfg] = await Promise.all([
        marketConfigApi.getMarketStatus(),
        marketConfigApi.list(),
      ]);
      setStatus(st);
      setConfigs(cfg.data || []);
      const draft: Record<string, string> = {};
      for (const c of cfg.data || []) draft[c.key] = c.value;
      setEditing(draft);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const isOpen = status?.market_open ?? true;

  const toggleMarket = async () => {
    const next = !isOpen;
    const reason = prompt(`将市场设为：${next ? "开市" : "休市"}\n\n可填写原因（可选）：`) ?? "";
    setSaving(true);
    try {
      await marketConfigApi.setMarketStatus(next, reason);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const saveConfig = async (key: string) => {
    try {
      const item = configs.find((c) => c.key === key);
      await marketConfigApi.set(key, editing[key] ?? "", item?.description);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const addConfig = async () => {
    if (!newKey.trim()) return;
    try {
      await marketConfigApi.set(newKey.trim(), newValue, newDesc.trim() || undefined);
      setNewKey("");
      setNewValue("");
      setNewDesc("");
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const removeConfig = async (key: string) => {
    if (!confirm(`确认删除配置「${key}」？`)) return;
    try {
      await marketConfigApi.delete(key);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="市场配置" description="控制开闭市状态与平台键值配置" />

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-600 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <Panel
        title="市场状态"
        subtitle="关闭后用户无法发起新交易，但可查看行情"
        actions={
          <Button variant={isOpen ? "danger" : "primary"} onClick={toggleMarket} loading={saving}>
            {isOpen ? (
              <>
                <PowerOff className="w-4 h-4" />
                休市
              </>
            ) : (
              <>
                <Power className="w-4 h-4" />
                开市
              </>
            )}
          </Button>
        }
      >
        <div className="flex items-center gap-4">
          <div className={`w-3 h-3 rounded-full ${isOpen ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
          <div>
            <p className={`text-lg font-bold ${isOpen ? "text-green-600" : "text-red-600"}`}>
              {isOpen ? "市场开放中" : "市场休市中"}
            </p>
            {(status?.reason || status?.message) && (
              <p className="text-sm text-t-muted mt-1">备注：{status.reason || status.message}</p>
            )}
          </div>
        </div>
      </Panel>

      <div className="mt-4">
        <Panel title="键值配置" subtitle="高级参数（如 market_open / market_close_reason 等）">
          <div className="space-y-3">
            {configs.length === 0 ? (
              <div className="text-sm text-t-muted py-4 text-center">暂无配置项</div>
            ) : (
              configs.map((c) => (
                <div key={c.key} className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-2 items-center border-b border-t-border/50 pb-3">
                  <div>
                    <div className="font-mono text-xs text-t-text">{c.key}</div>
                    {c.description && <div className="text-[11px] text-t-muted mt-0.5">{c.description}</div>}
                  </div>
                  <input
                    className="form-input"
                    value={editing[c.key] ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, [c.key]: e.target.value }))}
                  />
                  <div className="flex gap-1 justify-end">
                    <Button variant="secondary" size="sm" onClick={() => saveConfig(c.key)}>
                      <Save className="w-3.5 h-3.5" />
                      保存
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeConfig(c.key)}>
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))
            )}

            <div className="pt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
              <Input label="新 Key" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="如 feature_flag_x" />
              <Input label="Value" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
              <Input label="说明" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            </div>
            <Button onClick={addConfig} disabled={!newKey.trim()}>
              新增配置
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
