"use client";

import React, { useEffect, useState, useCallback } from "react";
import { PageHeader, Panel, Button, Input, Modal } from "@/components/ui";
import { cronTaskApi } from "@/lib/api";
import type { CronTask } from "@/lib/types";
import { Plus, Pencil, Trash2, Power, PowerOff, AlertCircle } from "lucide-react";

type FormState = {
  name: string;
  description: string;
  task_type: "interval" | "cron";
  interval_seconds: number;
  cron_expr: string;
  enabled: boolean;
};

const emptyForm = (): FormState => ({
  name: "",
  description: "",
  task_type: "cron",
  interval_seconds: 60,
  cron_expr: "0 16 * * 1-5",
  enabled: true,
});

export default function CronTasksPage() {
  const [tasks, setTasks] = useState<CronTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CronTask | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await cronTaskApi.list();
      setTasks(res.data || []);
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
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (t: CronTask) => {
    setEditTarget(t);
    setForm({
      name: t.name,
      description: t.description || "",
      task_type: t.task_type === "interval" ? "interval" : "cron",
      interval_seconds: t.interval_seconds || 60,
      cron_expr: t.cron_expr || "",
      enabled: t.enabled ?? true,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (form.task_type === "cron" && !form.cron_expr.trim()) {
      alert("cron 类型必须填写表达式");
      return;
    }
    if (form.task_type === "interval" && form.interval_seconds <= 0) {
      alert("interval 类型必须填写正整数秒数");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        task_type: form.task_type,
        interval_seconds: form.task_type === "interval" ? form.interval_seconds : null,
        cron_expr: form.task_type === "cron" ? form.cron_expr.trim() : null,
        enabled: form.enabled,
      };
      if (editTarget) {
        await cronTaskApi.update(editTarget.id, payload);
      } else {
        await cronTaskApi.create(payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (task: CronTask) => {
    setActionLoading(String(task.id));
    try {
      await cronTaskApi.toggle(task.id, !task.enabled);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string | number) => {
    if (!confirm("确认删除该任务？")) return;
    try {
      await cronTaskApi.delete(id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const scheduleText = (task: CronTask) => {
    if (task.task_type === "interval") {
      return `每 ${task.interval_seconds ?? "?"} 秒`;
    }
    return task.cron_expr || "—";
  };

  return (
    <div>
      <PageHeader
        title="定时任务"
        description="配置 interval / cron 调度任务（过期挂牌、收盘等）"
        actions={
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4" />
            新增任务
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
        ) : tasks.length === 0 ? (
          <div className="text-center py-12 text-t-muted">暂无定时任务</div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <div
                key={String(task.id)}
                className="flex items-center justify-between p-4 bg-t-panel border border-t-border rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-medium text-t-text">{task.name}</span>
                    <span className="status-badge active">{task.task_type}</span>
                    <span className={`status-badge ${task.enabled ? "active" : "off"}`}>
                      {task.enabled ? "启用" : "禁用"}
                    </span>
                    {task.last_status && (
                      <span className="text-[11px] text-t-muted">上次：{task.last_status}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1.5 text-xs text-t-muted flex-wrap">
                    <span className="font-mono bg-t-bg px-2 py-0.5 rounded">{scheduleText(task)}</span>
                    {task.description && <span>{task.description}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggle(task)}
                    loading={actionLoading === String(task.id)}
                    title={task.enabled ? "禁用" : "启用"}
                  >
                    {task.enabled ? (
                      <PowerOff className="w-4 h-4 text-orange-500" />
                    ) : (
                      <Power className="w-4 h-4 text-green-500" />
                    )}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(task)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(task.id)}>
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? "编辑任务" : "新增任务"}>
        <div className="space-y-4">
          <Input
            label="任务名称"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="如 expire_listings"
          />
          <div className="flex flex-col gap-1">
            <label className="form-label">调度类型</label>
            <select
              className="form-input"
              value={form.task_type}
              onChange={(e) =>
                setForm((f) => ({ ...f, task_type: e.target.value as "interval" | "cron" }))
              }
            >
              <option value="cron">cron 表达式</option>
              <option value="interval">固定间隔（秒）</option>
            </select>
          </div>
          {form.task_type === "cron" ? (
            <Input
              label="Cron 表达式"
              value={form.cron_expr}
              onChange={(e) => setForm((f) => ({ ...f, cron_expr: e.target.value }))}
              placeholder="0 16 * * 1-5"
            />
          ) : (
            <Input
              label="间隔秒数"
              type="number"
              value={form.interval_seconds}
              onChange={(e) =>
                setForm((f) => ({ ...f, interval_seconds: parseInt(e.target.value, 10) || 0 }))
              }
            />
          )}
          <Input
            label="描述"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="可选"
          />
          <label className="flex items-center gap-2 text-sm text-t-text cursor-pointer">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="w-4 h-4 rounded border-t-border accent-brand-500"
            />
            启用
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
