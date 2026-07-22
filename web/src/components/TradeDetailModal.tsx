"use client";

import { useCallback, useRef, useState } from "react";
import type { TradeRecord } from "@/lib/types";
import { toast } from "./Toast";

interface Props {
  trade: TradeRecord;
  productName: string;
  myUserID?: string;
  onClose: () => void;
}

function fmtDateTime(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${dd} ${hh}:${mm}:${ss}`;
}

/** 成交单号：T + 上海日期(yyMMdd) + 流水号（自然变长，不再卡死 6 位）
 * 例：T260718-1、T260718-1000000
 */
export function formatTradeNo(serial?: number | null, tradedAt?: string | null): string {
  if (serial == null || serial <= 0) return "-";
  const seq = String(Math.floor(serial));
  if (tradedAt) {
    try {
      const d = new Date(tradedAt);
      if (!Number.isNaN(d.getTime())) {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: "Asia/Shanghai",
          year: "2-digit",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(d);
        const yy = parts.find((p) => p.type === "year")?.value ?? "";
        const mm = parts.find((p) => p.type === "month")?.value ?? "";
        const dd = parts.find((p) => p.type === "day")?.value ?? "";
        if (yy && mm && dd) return `T${yy}${mm}${dd}-${seq}`;
      }
    } catch {
      /* fall through */
    }
  }
  return `T${seq.padStart(6, "0")}`;
}

function formatSpecs(specs?: string | Record<string, unknown> | null): string {
  if (!specs) return "-";
  if (typeof specs === "string") return specs || "-";
  const entries = Object.entries(specs);
  if (entries.length === 0) return "-";
  return entries.map(([k, v]) => `${k}:${v}`).join(" ");
}

function freeStorageText(enabled?: boolean | null, days?: number | null): string {
  if (enabled === true) {
    return days && days > 0 ? `${days}天免仓` : "可免仓";
  }
  if (enabled === false) return "不免仓";
  return "-";
}

function sourceLabel(t: TradeRecord, myUserID?: string): string {
  const isAggressor = !!t.aggressor_user_id && t.aggressor_user_id === myUserID;
  switch (t.source) {
    case "take":
      return isAggressor ? "我主动摘盘" : "对方主动摘盘";
    case "counter_offer":
      return "商谈成交";
    case "swap":
      return "换盘成交";
    case "swap_private":
      return "双方换盘";
    default:
      return "自动撮合";
  }
}

function partyName(company?: string | null, username?: string | null): string {
  const c = company?.trim();
  if (c) return c;
  const u = username?.trim();
  if (u) return u;
  return "-";
}

type DetailLine = { label: string; value: string };

function buildDetailLines(
  t: TradeRecord,
  productName: string,
  myUserID?: string,
): DetailLine[] {
  const buyPay = t.buy_payment_method?.trim() || "-";
  const sellPay = t.sell_payment_method?.trim() || "-";
  const buySpecs = formatSpecs(t.buy_specs);
  const sellSpecs = formatSpecs(t.sell_specs);

  const lines: DetailLine[] = [
    { label: "成交时间", value: fmtDateTime(t.traded_at) },
    { label: "品种", value: productName || t.product_id },
    { label: "成交价", value: `¥${t.price.toLocaleString()}` },
    { label: "数量", value: `${t.quantity.toLocaleString()} 吨` },
    { label: "金额", value: `¥${t.amount.toLocaleString()}` },
    { label: "成交来源", value: sourceLabel(t, myUserID) },
    { label: "交割期", value: t.delivery_period || "-" },
    { label: "交割地", value: t.delivery_location || "-" },
    { label: "交割方式", value: t.delivery_method || "-" },
    { label: "免仓期", value: freeStorageText(t.free_storage_enabled, t.free_storage_days) },
  ];

  if (buyPay === sellPay) {
    lines.push({ label: "付款方式", value: buyPay });
  } else {
    lines.push({ label: "买方付款", value: buyPay });
    lines.push({ label: "卖方付款", value: sellPay });
  }

  if (buySpecs === sellSpecs) {
    lines.push({ label: "规格", value: buySpecs });
  } else {
    lines.push({ label: "买方规格", value: buySpecs });
    lines.push({ label: "卖方规格", value: sellSpecs });
  }

  return lines;
}

/** 金十快讯风格纯文本 */
function buildShareText(
  t: TradeRecord,
  productName: string,
  myUserID?: string,
): string {
  const tradeNo = formatTradeNo(t.serial_no, t.traded_at);
  const isBuyer = !!myUserID && t.buy_user_id === myUserID;
  const isSeller = !!myUserID && t.sell_user_id === myUserID;
  const buy = partyName(t.buy_company_name, t.buy_username);
  const sell = partyName(t.sell_company_name, t.sell_username);
  const lines = buildDetailLines(t, productName, myUserID);

  const parts = [
    `【成交单 ${tradeNo}】`,
    `买方：${buy}${isBuyer ? "（我）" : ""}`,
    `卖方：${sell}${isSeller ? "（我）" : ""}`,
    ...lines.map((l) => `${l.label}：${l.value}`),
    "",
    "来源：禾合 ChemBridge",
  ];
  return parts.join("\n");
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  if (!text) return ["-"];
  const chars = [...text];
  const rows: string[] = [];
  let line = "";
  for (const ch of chars) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line) {
      rows.push(line);
      line = ch;
    } else {
      line = next;
    }
  }
  if (line) rows.push(line);
  return rows.length ? rows : ["-"];
}

/** 生成金十风格分享长图（浅色卡片，便于微信等场景） */
function renderShareCard(
  t: TradeRecord,
  productName: string,
  myUserID?: string,
): HTMLCanvasElement {
  const tradeNo = formatTradeNo(t.serial_no, t.traded_at);
  const isBuyer = !!myUserID && t.buy_user_id === myUserID;
  const isSeller = !!myUserID && t.sell_user_id === myUserID;
  const buy = partyName(t.buy_company_name, t.buy_username);
  const sell = partyName(t.sell_company_name, t.sell_username);
  const detailLines = buildDetailLines(t, productName, myUserID);

  const W = 720;
  const padX = 40;
  const contentW = W - padX * 2;
  const labelW = 120;

  // 预估高度
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = "28px sans-serif";
  let bodyH = 0;
  const partyBlocks = [
    { title: `买方${isBuyer ? "（我）" : ""}`, value: buy },
    { title: `卖方${isSeller ? "（我）" : ""}`, value: sell },
  ];
  for (const p of partyBlocks) {
    bodyH += 36 + wrapText(probe, p.value, contentW - 8).length * 36 + 16;
  }
  bodyH += 24;
  for (const row of detailLines) {
    const valueRows = wrapText(probe, row.value, contentW - labelW - 16);
    bodyH += Math.max(40, valueRows.length * 34 + 8);
  }

  const headerH = 120;
  const footerH = 72;
  const H = headerH + bodyH + footerH + 48;

  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  // 背景
  ctx.fillStyle = "#f4f6f8";
  ctx.fillRect(0, 0, W, H);

  // 白卡片
  const cardX = 20;
  const cardY = 20;
  const cardW = W - 40;
  const cardH = H - 40;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, cardX, cardY, cardW, cardH, 16);
  ctx.fill();

  // 顶栏
  const grad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY);
  grad.addColorStop(0, "#0f766e");
  grad.addColorStop(1, "#0d9488");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(cardX + 16, cardY);
  ctx.arcTo(cardX + cardW, cardY, cardX + cardW, cardY + 88, 16);
  ctx.lineTo(cardX + cardW, cardY + 88);
  ctx.lineTo(cardX, cardY + 88);
  ctx.arcTo(cardX, cardY, cardX + cardW, cardY, 16);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText("禾合 ChemBridge · 成交单", cardX + 28, cardY + 38);
  ctx.font = "24px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillText(tradeNo, cardX + 28, cardY + 70);

  let y = cardY + 112;

  // 买卖双方
  for (const p of partyBlocks) {
    ctx.fillStyle = p.title.startsWith("买方") ? "#b91c1c" : "#15803d";
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(p.title, cardX + padX - 20, y);
    y += 32;
    ctx.fillStyle = "#111827";
    ctx.font = "26px sans-serif";
    for (const row of wrapText(ctx, p.value, contentW)) {
      ctx.fillText(row, cardX + padX - 20, y);
      y += 34;
    }
    y += 10;
  }

  // 分隔线
  y += 4;
  ctx.strokeStyle = "#e5e7eb";
  ctx.beginPath();
  ctx.moveTo(cardX + 24, y);
  ctx.lineTo(cardX + cardW - 24, y);
  ctx.stroke();
  y += 28;

  ctx.font = "bold 22px sans-serif";
  ctx.fillStyle = "#6b7280";
  ctx.fillText("成交细节", cardX + padX - 20, y);
  y += 36;

  for (const row of detailLines) {
    const valueRows = wrapText(ctx, row.value, contentW - labelW);
    const blockH = Math.max(36, valueRows.length * 32);
    ctx.fillStyle = "#6b7280";
    ctx.font = "22px sans-serif";
    ctx.fillText(row.label, cardX + padX - 20, y);
    ctx.fillStyle = "#111827";
    ctx.font = "24px sans-serif";
    let vy = y;
    for (const vr of valueRows) {
      ctx.fillText(vr, cardX + padX - 20 + labelW, vy);
      vy += 32;
    }
    y += blockH + 6;
  }

  // 页脚
  ctx.fillStyle = "#9ca3af";
  ctx.font = "20px sans-serif";
  ctx.fillText("trade.snailchemical.com", cardX + 28, cardY + cardH - 28);

  return canvas;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("生成图片失败"))), "image/png");
  });
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function InfoRow({ label, value, colorCls }: { label: string; value: string; colorCls?: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5 px-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
      <span className="text-[11px] text-t-text-3 whitespace-nowrap shrink-0 min-w-[72px]">{label}</span>
      <span className={`text-[12px] flex-1 break-all ${colorCls ?? "text-t-text"}`}>{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-3 py-1.5 text-[11px] font-semibold border-b text-t-text-2 bg-t-tertiary"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      {children}
    </div>
  );
}

export default function TradeDetailModal({ trade: t, productName, myUserID, onClose }: Props) {
  const isBuyer = !!myUserID && t.buy_user_id === myUserID;
  const isSeller = !!myUserID && t.sell_user_id === myUserID;
  const tradeNo = formatTradeNo(t.serial_no, t.traded_at);
  const detailLines = buildDetailLines(t, productName, myUserID);

  const [shareOpen, setShareOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const shareBtnRef = useRef<HTMLDivElement>(null);

  const handleCopyText = useCallback(async () => {
    try {
      await copyTextToClipboard(buildShareText(t, productName, myUserID));
      toast("已复制文字", "success");
      setShareOpen(false);
    } catch {
      toast("复制失败，请重试", "error");
    }
  }, [t, productName, myUserID]);

  const handleGenerateImage = useCallback(async () => {
    setBusy(true);
    setShareOpen(false);
    try {
      const canvas = renderShareCard(t, productName, myUserID);
      const blob = await canvasToPngBlob(canvas);
      const url = URL.createObjectURL(blob);
      setPreviewBlob(blob);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      const ok = await copyImageToClipboard(blob);
      toast(ok ? "图片已生成并复制到剪贴板" : "图片已生成，可保存或手动复制", ok ? "success" : "info");
    } catch {
      toast("生成图片失败", "error");
    } finally {
      setBusy(false);
    }
  }, [t, productName, myUserID]);

  const handleCopyPreviewImage = useCallback(async () => {
    if (!previewBlob) return;
    const ok = await copyImageToClipboard(previewBlob);
    toast(ok ? "图片已复制到剪贴板" : "当前环境不支持复制图片，请保存后发送", ok ? "success" : "info");
  }, [previewBlob]);

  const handleSavePreviewImage = useCallback(() => {
    if (!previewBlob) return;
    downloadBlob(previewBlob, `成交单_${tradeNo}.png`);
    toast("图片已保存", "success");
  }, [previewBlob, tradeNo]);

  const closePreview = useCallback(() => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPreviewBlob(null);
  }, []);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div
        className="relative w-[560px] max-h-[85vh] flex flex-col rounded-xl shadow-2xl border overflow-hidden"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-color)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="shrink-0 flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: "var(--border-color)" }}
        >
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-t-text">成交详情</span>
            <span className="text-xs font-mono text-t-text-3">{tradeNo}</span>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-t-hover text-t-text-3 hover:text-t-text transition-colors"
            aria-label="关闭"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* 买卖双方（仅身份） */}
          <div className="flex flex-col sm:flex-row border-b" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex-1 min-w-0 border-b sm:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="px-3 py-1.5 text-[11px] font-semibold text-trade-up-text bg-trade-up-bg">
                买方{isBuyer ? "（我）" : ""}
              </div>
              <div className="px-3 py-2.5 text-[12px] text-t-text break-all">
                {partyName(t.buy_company_name, t.buy_username)}
              </div>
            </div>
            <div className="hidden sm:block w-px self-stretch bg-[var(--border-subtle)]" />
            <div className="flex-1 min-w-0">
              <div className="px-3 py-1.5 text-[11px] font-semibold text-trade-down-text bg-trade-down-bg">
                卖方{isSeller ? "（我）" : ""}
              </div>
              <div className="px-3 py-2.5 text-[12px] text-t-text break-all">
                {partyName(t.sell_company_name, t.sell_username)}
              </div>
            </div>
          </div>

          <SectionTitle>成交细节</SectionTitle>
          {detailLines.map((row) => (
            <InfoRow
              key={row.label}
              label={row.label}
              value={row.value}
              colorCls={
                row.label === "成交价"
                  ? "font-mono font-medium"
                  : row.label === "金额"
                    ? "font-mono text-brand-600 font-medium"
                    : row.label === "数量"
                      ? "font-mono"
                      : undefined
              }
            />
          ))}
        </div>

        {/* 金十风格底栏：复制 / 生成图片 */}
        <div
          className="shrink-0 flex items-center justify-between gap-2 px-3 py-2.5 border-t"
          style={{ borderColor: "var(--border-color)", backgroundColor: "var(--bg-tertiary, var(--bg-panel))" }}
        >
          <span className="text-[11px] text-t-text-3">支持复制文字或生成分享图</span>
          <div className="relative" ref={shareBtnRef}>
            <button
              type="button"
              disabled={busy}
              onClick={() => setShareOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              {busy ? "生成中…" : "分享"}
            </button>
            {shareOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShareOpen(false)} />
                <div
                  className="absolute right-0 bottom-full mb-1.5 z-20 w-40 rounded-lg border shadow-lg overflow-hidden"
                  style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-color)" }}
                >
                  <button
                    type="button"
                    onClick={handleCopyText}
                    className="w-full text-left px-3 py-2.5 text-xs text-t-text hover:bg-t-hover transition-colors border-b"
                    style={{ borderColor: "var(--border-subtle)" }}
                  >
                    复制文字
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerateImage}
                    className="w-full text-left px-3 py-2.5 text-xs text-t-text hover:bg-t-hover transition-colors"
                  >
                    生成图片
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 图片预览（金十长图分享预览） */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center p-4"
          onClick={(e) => {
            e.stopPropagation();
            closePreview();
          }}
        >
          <div className="absolute inset-0 bg-black/70" />
          <div
            className="relative z-10 w-full max-w-[420px] max-h-[90vh] flex flex-col rounded-xl overflow-hidden border shadow-2xl"
            style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-color)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border-color)" }}>
              <span className="text-sm font-semibold text-t-text">分享图片预览</span>
              <button
                onClick={closePreview}
                className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-t-hover text-t-text-3"
                aria-label="关闭"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto bg-t-hover p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt={`成交单 ${tradeNo}`} className="w-full rounded-lg shadow" />
            </div>
            <div className="flex gap-2 px-3 py-3 border-t" style={{ borderColor: "var(--border-color)" }}>
              <button
                type="button"
                onClick={handleCopyPreviewImage}
                className="flex-1 py-2 text-xs font-medium rounded-md border border-t-border text-t-text hover:bg-t-hover transition-colors"
              >
                复制图片
              </button>
              <button
                type="button"
                onClick={handleSavePreviewImage}
                className="flex-1 py-2 text-xs font-medium rounded-md bg-brand-600 text-white hover:bg-brand-700 transition-colors"
              >
                保存图片
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
