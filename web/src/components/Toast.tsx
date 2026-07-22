"use client";

import { useEffect, useState, useCallback } from "react";

interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

let addToastFn: ((message: string, type: Toast["type"]) => void) | null = null;

/** 全局 Toast 调用函数（跨组件使用） */
export function toast(message: string, type: Toast["type"] = "info") {
  addToastFn?.(message, type);
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: Toast["type"]) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  if (toasts.length === 0) return null;

  const typeStyles: Record<Toast["type"], string> = {
    success: "bg-emerald-500/90 text-white",
    error: "bg-red-500/90 text-white",
    info: "bg-sky-500/90 text-white",
  };

  return (
    <div className="fixed inset-x-0 top-14 z-[9999] flex flex-col items-center gap-2 px-3 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={`relative w-full max-w-3xl flex items-center justify-center gap-3 px-10 py-2.5 rounded-lg shadow-2xl text-sm font-medium backdrop-blur-sm animate-toast-in pointer-events-auto ${typeStyles[t.type]}`}
        >
          <span className="text-center flex-1 min-w-0">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="absolute right-2 top-1/2 -translate-y-1/2 shrink-0 p-1 rounded hover:bg-white/20 transition-colors"
            aria-label="关闭提示"
            title="关闭"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(-12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-toast-in { animation: toast-in 0.2s ease-out; }
      `}</style>
    </div>
  );
}
