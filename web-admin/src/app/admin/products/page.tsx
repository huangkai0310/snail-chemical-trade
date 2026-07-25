"use client";

import React, { useEffect, useState, useCallback } from "react";
import { PageHeader, Panel, Button, Input, Modal } from "@/components/ui";
import { productApi } from "@/lib/api";
import type { Product } from "@/lib/types";
import { Plus, Pencil, Trash2, AlertCircle } from "lucide-react";

type FormState = {
  id: string;
  name: string;
  name_en: string;
  unit: string;
  category: string;
  sort_order: number;
  active: boolean;
};

const emptyForm = (): FormState => ({
  id: "",
  name: "",
  name_en: "",
  unit: "吨",
  category: "",
  sort_order: 0,
  active: true,
});

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await productApi.list();
      setProducts(res.data || []);
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

  const openCreate = () => {
    setEditTarget(null);
    setForm({ ...emptyForm(), sort_order: products.length });
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditTarget(p);
    setForm({
      id: p.id,
      name: p.name,
      name_en: p.name_en || "",
      unit: p.unit,
      category: p.category || "",
      sort_order: p.sort_order ?? 0,
      active: p.active !== false,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.id.trim() || !form.name.trim()) return;
    setSaving(true);
    try {
      const nameEn = form.name_en.trim() || null;
      const category = form.category.trim() || null;
      if (editTarget) {
        await productApi.update(form.id, {
          name: form.name.trim(),
          name_en: nameEn,
          unit: form.unit.trim() || "吨",
          category,
          sort_order: form.sort_order,
          active: form.active,
        });
      } else {
        await productApi.create({
          id: form.id.trim(),
          name: form.name.trim(),
          name_en: nameEn,
          unit: form.unit.trim() || "吨",
          category,
          sort_order: form.sort_order,
        });
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`确认删除品种「${id}」？`)) return;
    try {
      await productApi.delete(id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="品种管理"
        description="管理交易品种（纯苯、丙烯等化工品）"
        actions={
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4" />
            新增品种
          </Button>
        }
      />

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-600 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <Panel>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin h-8 w-8 border-2 border-brand-500 border-t-transparent rounded-full" />
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-12 text-t-muted">暂无品种，点击右上角新增</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border">
                  <th className="text-left py-3 px-3 text-t-muted font-medium">ID</th>
                  <th className="text-left py-3 px-3 text-t-muted font-medium">名称</th>
                  <th className="text-left py-3 px-3 text-t-muted font-medium">英文名</th>
                  <th className="text-left py-3 px-3 text-t-muted font-medium">单位</th>
                  <th className="text-left py-3 px-3 text-t-muted font-medium">分类</th>
                  <th className="text-left py-3 px-3 text-t-muted font-medium">排序</th>
                  <th className="text-left py-3 px-3 text-t-muted font-medium">状态</th>
                  <th className="text-right py-3 px-3 text-t-muted font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-b border-t-border/50 hover:bg-t-hover/50">
                    <td className="py-3 px-3 font-mono text-xs text-t-muted">{p.id}</td>
                    <td className="py-3 px-3 font-medium text-t-text">{p.name}</td>
                    <td className="py-3 px-3 text-t-secondary">{p.name_en || "—"}</td>
                    <td className="py-3 px-3 text-t-secondary">{p.unit}</td>
                    <td className="py-3 px-3 text-t-secondary">{p.category || "—"}</td>
                    <td className="py-3 px-3 text-t-secondary">{p.sort_order ?? 0}</td>
                    <td className="py-3 px-3">
                      <span className={`status-badge ${p.active ? "active" : "off"}`}>
                        {p.active ? "启用" : "禁用"}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(p.id)}>
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? "编辑品种" : "新增品种"}>
        <div className="space-y-4">
          <Input
            label="品种 ID（英文）"
            value={form.id}
            onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
            placeholder="如 benzene"
            disabled={!!editTarget}
          />
          <Input
            label="中文名称"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="如 纯苯"
          />
          <Input
            label="英文名称"
            value={form.name_en}
            onChange={(e) => setForm((f) => ({ ...f, name_en: e.target.value }))}
            placeholder="如 Benzene"
          />
          <Input
            label="单位"
            value={form.unit}
            onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
            placeholder="吨"
          />
          <Input
            label="分类"
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            placeholder="如 芳烃"
          />
          <Input
            label="排序"
            type="number"
            value={form.sort_order}
            onChange={(e) => setForm((f) => ({ ...f, sort_order: parseInt(e.target.value, 10) || 0 }))}
          />
          {editTarget && (
            <label className="flex items-center gap-2 text-sm text-t-text cursor-pointer">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="w-4 h-4 rounded border-t-border accent-brand-500"
              />
              启用
            </label>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave} loading={saving}>
              保存
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
