"use client";

import React, { useEffect, useState, useCallback } from "react";
import { PageHeader, Panel, Button, Input, Modal } from "@/components/ui";
import { holidayApi } from "@/lib/api";
import { formatDateOnly, type Holiday } from "@/lib/types";
import { Plus, Trash2, AlertCircle } from "lucide-react";

const currentYear = new Date().getFullYear();
const years = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

export default function HolidaysPage() {
  const [year, setYear] = useState(currentYear);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ date: "", name: "", is_holiday: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await holidayApi.list(year);
      setHolidays(res.data || []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (!form.date || !form.name.trim()) return;
    setSaving(true);
    try {
      await holidayApi.create({
        date: form.date,
        name: form.name.trim(),
        is_holiday: form.is_holiday,
      });
      setModalOpen(false);
      setForm({ date: "", name: "", is_holiday: true });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string | number) => {
    if (!confirm("确认删除该记录？")) return;
    try {
      await holidayApi.delete(id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleBatchImport = async () => {
    const text = prompt("批量导入（每行：日期,名称），如：\n2026-01-01,元旦\n2026-01-02,元旦调休");
    if (!text) return;
    const items = text
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [date, name] = line.split(",").map((s) => s.trim());
        return { date, name: name || "节假日", is_holiday: true };
      })
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date));

    if (items.length === 0) {
      alert("没有有效行，请使用 YYYY-MM-DD,名称 格式");
      return;
    }
    try {
      await holidayApi.batchUpsert(items);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="节假日管理"
        description="设置交易日历：休市日 / 调休工作日"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleBatchImport}>
              批量导入
            </Button>
            <Button
              onClick={() => {
                setForm({ date: "", name: "", is_holiday: true });
                setModalOpen(true);
              }}
            >
              <Plus className="w-4 h-4" />
              新增
            </Button>
          </div>
        }
      />

      <div className="flex gap-2 mb-4">
        {years.map((y) => (
          <button
            key={y}
            onClick={() => setYear(y)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              year === y
                ? "bg-brand-500 text-white"
                : "bg-t-card border border-t-border text-t-secondary hover:text-t-text"
            }`}
          >
            {y} 年
          </button>
        ))}
      </div>

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
        ) : holidays.length === 0 ? (
          <div className="text-center py-12 text-t-muted">{year} 年暂无节假日记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border">
                  <th className="text-left py-3 px-3 text-t-muted font-medium">日期</th>
                  <th className="text-left py-3 px-3 text-t-muted font-medium">名称</th>
                  <th className="text-left py-3 px-3 text-t-muted font-medium">类型</th>
                  <th className="text-right py-3 px-3 text-t-muted font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {holidays.map((h) => (
                  <tr key={String(h.id)} className="border-b border-t-border/50 hover:bg-t-hover/50">
                    <td className="py-3 px-3 font-mono text-sm text-t-text">{formatDateOnly(h.date)}</td>
                    <td className="py-3 px-3 font-medium text-t-text">{h.name || "—"}</td>
                    <td className="py-3 px-3">
                      <span className={`status-badge ${h.is_holiday ? "off" : "active"}`}>
                        {h.is_holiday ? "休市" : "调休上班"}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(h.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="新增日历日期">
        <div className="space-y-4">
          <Input
            label="日期"
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
          <Input
            label="名称"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="如 元旦"
          />
          <label className="flex items-center gap-2 text-sm text-t-text cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_holiday}
              onChange={(e) => setForm((f) => ({ ...f, is_holiday: e.target.checked }))}
              className="w-4 h-4 rounded border-t-border accent-brand-500"
            />
            休市日（取消勾选 = 调休上班日）
          </label>
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
