"use client";

import React, { useEffect, useState, useCallback } from "react";
import { PageHeader, Panel, Button, Input, Modal } from "@/components/ui";
import { dictApi } from "@/lib/api";
import type { DictItem } from "@/lib/types";
import { Plus, Pencil, Trash2, AlertCircle } from "lucide-react";

const DICT_TYPES = [
  { value: "delivery-periods", label: "交割期" },
  { value: "delivery-locations", label: "交割地点" },
  { value: "payment-methods", label: "付款方式" },
  { value: "product-specs", label: "规格" },
  { value: "delivery-methods", label: "交割方式" },
  { value: "free-storage", label: "免仓天数配置" },
];

export default function DictPage() {
  const [dictType, setDictType] = useState("delivery-periods");
  const [items, setItems] = useState<DictItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DictItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", sort_order: 0, active: true, days: 0, min_quantity: 100 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await dictApi.list(dictType);
      setItems(res.data);
      setError("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [dictType]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditTarget(null);
    setForm({ name: "", sort_order: items.length, active: true, days: 0, min_quantity: 100 });
    setModalOpen(true);
  };

  const openEdit = (item: DictItem) => {
    setEditTarget(item);
    setForm({
      name: item.name,
      sort_order: item.sort_order ?? 0,
      active: item.active ?? true,
      days: item.days ?? 0,
      min_quantity: item.min_quantity ?? 100,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    // 免仓天数配置需要 days 必填
    if (dictType === "free-storage" && !form.days) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { name: form.name.trim(), sort_order: form.sort_order, active: form.active };
      if (dictType === "free-storage") {
        payload.days = form.days;
        payload.min_quantity = form.min_quantity;
      }
      if (editTarget) {
        await dictApi.update(dictType, editTarget.id, payload);
      } else {
        await dictApi.create(dictType, payload);
      }
      setModalOpen(false);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string | number) => {
    if (!confirm("确认删除？")) return;
    try {
      await dictApi.delete(dictType, id);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="字典表管理"
        description="管理交易相关下拉选项（交割期、交割地点、付款方式、规格）"
        actions={<Button onClick={openCreate}><Plus className="w-4 h-4" />新增</Button>}
      />

      {/* 字典类型切换 */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {DICT_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setDictType(t.value)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              dictType === t.value
                ? "bg-brand-500 text-white"
                : "bg-t-card border border-t-border text-t-secondary hover:text-t-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-600 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      <Panel>
        {loading ? (
          <div className="flex justify-center py-8"><div className="animate-spin h-8 w-8 border-2 border-brand-500 border-t-transparent rounded-full" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-t-muted">暂无数据</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border">
                  <th className="text-left py-3 px-3 text-t-muted font-medium">名称</th>
                  <th className="text-left py-3 px-3 text-t-muted font-medium">排序</th>
                  {dictType === "free-storage" && (
                    <>
                      <th className="text-left py-3 px-3 text-t-muted font-medium">天数</th>
                      <th className="text-left py-3 px-3 text-t-muted font-medium">最小量</th>
                    </>
                  )}
                  <th className="text-left py-3 px-3 text-t-muted font-medium">状态</th>
                  <th className="text-right py-3 px-3 text-t-muted font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={String(item.id)} className="border-b border-t-border/50 hover:bg-t-hover/50">
                    <td className="py-3 px-3 font-medium text-t-text">{item.name}</td>
                    <td className="py-3 px-3 text-t-secondary">{item.sort_order ?? 0}</td>
                    {dictType === "free-storage" && (
                      <>
                        <td className="py-3 px-3 text-t-secondary">{item.days ?? "—"}</td>
                        <td className="py-3 px-3 text-t-secondary">{item.min_quantity ?? "—"}</td>
                      </>
                    )}
                    <td className="py-3 px-3">
                      <span className={`status-badge ${item.active !== false ? "active" : "off"}`}>
                        {item.active !== false ? "启用" : "禁用"}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(item.id)}>
                          <Trash2 className="w-3.5 h-3.5 text-red-500" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editTarget ? "编辑字典项" : "新增字典项"}
      >
        <div className="space-y-4">
          <Input label="名称" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="如 7月、先款后货" />
          <Input label="排序" type="number" value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))} />
          {dictType === "free-storage" && (
            <>
              <Input label="免仓天数" type="number" value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: parseInt(e.target.value) || 0 }))} placeholder="如 7" />
              <Input label="最小数量阈值" type="number" value={form.min_quantity} onChange={(e) => setForm((f) => ({ ...f, min_quantity: parseFloat(e.target.value) || 0 }))} placeholder="如 100" />
            </>
          )}
          <label className="flex items-center gap-2 text-sm text-t-text cursor-pointer">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              className="w-4 h-4 rounded border-t-border accent-brand-500"
            />
            启用
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>取消</Button>
            <Button onClick={handleSave} loading={saving}>保存</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
