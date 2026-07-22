"use client";

import type { CounterOffer } from "@/lib/types";
import type { ConfirmOptions } from "@/components/ConfirmDialog";
import {
  analyzeNegotiation,
  disputedTermKeys,
  getViewerRole,
  sideLabel,
  summarizeNegotiation,
  TERM_KEYS,
  TERM_LABELS,
} from "@/lib/negotiation";
import { formatBoardSerial } from "@/lib/format";
import { CounterOfferConfirmSheetFromCo } from "@/components/PostingConfirmSheet";

function freeStorageText(enabled: boolean | null | undefined, days: number | null | undefined): string {
  if (enabled == null) return "-";
  if (enabled) return `免仓${days != null && days > 0 ? `${days}天` : ""}`;
  return "不免仓";
}

function displayVal(co: CounterOffer, key: string, side: "ref" | "offer"): string {
  if (side === "offer") {
    switch (key) {
      case "price": return `¥${co.offer_price.toLocaleString()}/吨`;
      case "quantity": return `${co.offer_quantity.toLocaleString()}吨`;
      case "delivery_period": return co.offer_delivery_period ?? "—";
      case "delivery_location": return co.offer_delivery_location ?? "—";
      case "payment_method": return co.offer_payment_method ?? "—";
      case "delivery_method": return co.offer_delivery_method ?? "—";
      case "free_storage": return co.offer_free_storage_enabled == null ? "—" : freeStorageText(co.offer_free_storage_enabled, co.offer_free_storage_days);
      case "specs": return co.offer_specs?.trim() ? co.offer_specs : "—";
    }
  } else {
    switch (key) {
      case "price": return co.ref_price != null ? `¥${co.ref_price.toLocaleString()}/吨` : "-";
      case "quantity": return co.ref_quantity != null && co.ref_filled != null ? `${(co.ref_quantity - co.ref_filled).toLocaleString()}吨` : (co.ref_quantity != null ? `${co.ref_quantity.toLocaleString()}吨` : "-");
      case "delivery_period": return co.ref_delivery_period ?? "-";
      case "delivery_location": return co.ref_delivery_location ?? "-";
      case "payment_method": return co.ref_payment_method ?? "-";
      case "delivery_method": return co.ref_delivery_method ?? "-";
      case "free_storage": return freeStorageText(co.ref_free_storage_enabled, co.ref_free_storage_days);
      case "specs": return co.ref_specs?.trim() ? co.ref_specs : "-";
    }
  }
  return "-";
}

type Props = {
  sellCo: CounterOffer;
  buyCo: CounterOffer;
  myUserID?: string;
  coSubTab: "received" | "sent";
  productName?: string;
  formatDateTime: (iso: string) => string;
  coStatusLabel: (s: string) => string;
  coStatusColor: (s: string) => string;
  cancelReasonLabel: (r: string | null | undefined) => string;
  selectedTerms: Record<string, string[]>;
  toggleTerm: (co: CounterOffer, key: string) => void;
  getSel: (co: CounterOffer) => string[];
  onAcceptReceived: (co: CounterOffer) => void;
  acceptPending: boolean;
  rejectPending: boolean;
  onReject: (id: string) => void;
  cancelPending: boolean;
  onCancel: (id: string) => void;
  respondPending: boolean;
  onRespond: (p: { id: string; action: "accept" | "reject" }) => void;
  confirmDialog: (opts: ConfirmOptions | string) => Promise<boolean>;
};

function LegTermCell({
  co,
  legLabel,
  legCls,
  termKey,
  viewerRole,
  isPendingReceived,
  getSel,
  toggleTerm,
}: {
  co: CounterOffer;
  legLabel: string;
  legCls: string;
  termKey: string;
  viewerRole: ReturnType<typeof getViewerRole>;
  isPendingReceived: boolean;
  getSel: (co: CounterOffer) => string[];
  toggleTerm: (co: CounterOffer, key: string) => void;
}) {
  const a = analyzeNegotiation(co, viewerRole).find((t) => t.key === termKey)!;
  const refVal = displayVal(co, termKey, "ref");
  const offerVal = displayVal(co, termKey, "offer");
  const disputed = disputedTermKeys(co);
  const isDisputedTerm = (disputed as string[]).includes(termKey);
  const checked = isPendingReceived && isDisputedTerm ? getSel(co).includes(termKey) : false;

  return (
    <div className={`mb-2 last:mb-0 pb-2 last:pb-0 border-b last:border-b-0 border-t-border-subtle`}>
      <span className={`text-[10px] font-medium ${legCls}`}>{legLabel}</span>
      <div className="flex flex-col gap-0.5 mt-0.5">
        <span className={`text-xs ${a.changed ? "text-t-text" : "text-t-text-3"}`}>
          {sideLabel(viewerRole, "ref")}：{refVal}
        </span>
        <span className={`text-xs ${a.changed ? "text-trade-up-text font-medium" : "text-t-text-3"}`}>
          {sideLabel(viewerRole, "offer")}：{offerVal}
        </span>
        {a.changed && a.advantage !== "neutral" && (
          <span
            className={`text-[10px] px-1 py-0.5 rounded inline-block w-fit ${
              a.advantage === "good"
                ? "bg-status-success-bg text-status-success"
                : "bg-status-error-bg text-status-error"
            }`}
            title={a.hint}
          >
            {a.advantage === "good" ? "对您有利" : "对您不利"}
          </span>
        )}
        {a.changed && a.advantage === "neutral" && (
          <span
            className="text-[10px] px-1 py-0.5 rounded inline-block w-fit bg-t-hover text-t-text-2"
            title={a.hint}
          >
            尚可
          </span>
        )}
        {isPendingReceived && isDisputedTerm && (
          <label className="flex items-center gap-1 cursor-pointer mt-0.5">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggleTerm(co, termKey)}
              className="w-3.5 h-3.5 rounded border-t-border"
            />
            <span className="text-[10px] text-t-text-3">同意此项</span>
          </label>
        )}
      </div>
    </div>
  );
}

export default function DualSwapCounterOfferRow(props: Props) {
  const {
    sellCo,
    buyCo,
    myUserID,
    coSubTab,
    productName,
    formatDateTime,
    coStatusLabel,
    coStatusColor,
    cancelReasonLabel,
    onAcceptReceived,
    acceptPending,
    rejectPending,
    onReject,
    cancelPending,
    onCancel,
    respondPending,
    onRespond,
    confirmDialog,
    getSel,
    toggleTerm,
  } = props;

  const sellViewer = getViewerRole(sellCo, myUserID ?? "");
  const buyViewer = getViewerRole(buyCo, myUserID ?? "");
  const serial = sellCo.ref_serial_no ?? buyCo.ref_serial_no;
  const refCreatedAt = sellCo.ref_created_at ?? buyCo.ref_created_at;
  const status = sellCo.status === buyCo.status ? sellCo.status : sellCo.status;

  return (
    <tr className="hover:bg-t-hover transition-colors align-top bg-amber-500/5">
      <td className="px-3 py-3 whitespace-nowrap">
        {serial != null ? (
          <span className="font-mono text-xs font-medium text-t-text">
            {formatBoardSerial("S", serial, refCreatedAt)}
          </span>
        ) : (
          <span className="text-xs text-t-text-3">-</span>
        )}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <span className="text-xs text-t-text">{productName ?? "-"}</span>
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-brand-600/15 text-brand-600 w-fit">
            换 · 双向换盘
          </span>
          <span className="text-[10px] text-t-text-3">卖盘 + 买盘分别商谈</span>
        </div>
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <span className="text-xs text-t-text-3 font-mono">{formatDateTime(sellCo.created_at)}</span>
      </td>
      {TERM_KEYS.map((k) => (
        <td key={k} className="px-3 py-3 min-w-[140px]">
          <LegTermCell
            co={sellCo}
            legLabel="卖盘"
            legCls="text-green-600 dark:text-green-400"
            termKey={k}
            viewerRole={sellViewer}
            isPendingReceived={coSubTab === "received" && sellCo.status === "PENDING"}
            getSel={getSel}
            toggleTerm={toggleTerm}
          />
          <LegTermCell
            co={buyCo}
            legLabel="买盘"
            legCls="text-red-600 dark:text-red-400"
            termKey={k}
            viewerRole={buyViewer}
            isPendingReceived={coSubTab === "received" && buyCo.status === "PENDING"}
            getSel={getSel}
            toggleTerm={toggleTerm}
          />
        </td>
      ))}
      <td className="px-3 py-3 whitespace-nowrap">
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${coStatusColor(status)}`}>
          {coStatusLabel(status)}
        </span>
      </td>
      <td className="px-3 py-3 min-w-[200px]">
        <div className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5 mb-2">
          双向换盘商谈：下方分别对比卖盘、买盘条款。{summarizeNegotiation(sellCo, sellViewer)} / {summarizeNegotiation(buyCo, buyViewer)}
        </div>
        {coSubTab === "received" && sellCo.status === "PENDING" ? (
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-green-700 dark:text-green-400">卖盘商谈</div>
            <div className="flex gap-2">
              <button
                onClick={() => onAcceptReceived(sellCo)}
                disabled={acceptPending}
                className="text-xs px-2 py-1 rounded bg-status-success-bg text-status-success disabled:opacity-50"
              >
                接受卖盘
              </button>
              <button
                onClick={async () => {
                  if (!await confirmDialog({
                    title: "拒绝卖盘商谈",
                    message: "拒绝卖盘商谈？",
                    content: (
                      <CounterOfferConfirmSheetFromCo
                        co={sellCo}
                        productName={productName}
                        serialLabel={formatBoardSerial("S", sellCo.ref_serial_no, sellCo.ref_created_at)}
                        intro="请核对卖盘商谈条款后确认拒绝。"
                        outro="拒绝后对方将收到通知，此操作不可撤销。"
                      />
                    ),
                    wide: true,
                    variant: "danger",
                    icon: "danger",
                    confirmText: "拒绝",
                  })) return;
                  onReject(sellCo.id);
                }}
                disabled={rejectPending}
                className="text-xs px-2 py-1 rounded bg-status-error-bg text-status-error disabled:opacity-50"
              >
                拒绝
              </button>
            </div>
            <div className="text-[11px] font-medium text-red-700 dark:text-red-400">买盘商谈</div>
            <div className="flex gap-2">
              <button
                onClick={() => onAcceptReceived(buyCo)}
                disabled={acceptPending}
                className="text-xs px-2 py-1 rounded bg-status-success-bg text-status-success disabled:opacity-50"
              >
                接受买盘
              </button>
              <button
                onClick={async () => {
                  if (!await confirmDialog({
                    title: "拒绝买盘商谈",
                    message: "拒绝买盘商谈？",
                    content: (
                      <CounterOfferConfirmSheetFromCo
                        co={buyCo}
                        productName={productName}
                        serialLabel={formatBoardSerial("S", buyCo.ref_serial_no, buyCo.ref_created_at)}
                        intro="请核对买盘商谈条款后确认拒绝。"
                        outro="拒绝后对方将收到通知，此操作不可撤销。"
                      />
                    ),
                    wide: true,
                    variant: "danger",
                    icon: "danger",
                    confirmText: "拒绝",
                  })) return;
                  onReject(buyCo.id);
                }}
                disabled={rejectPending}
                className="text-xs px-2 py-1 rounded bg-status-error-bg text-status-error disabled:opacity-50"
              >
                拒绝
              </button>
            </div>
          </div>
        ) : coSubTab === "sent" && sellCo.status === "PENDING" ? (
          <button
            onClick={async () => {
              if (!await confirmDialog({
                title: "撤销双向商谈",
                message: "撤销双向商谈（卖盘+买盘）？",
                content: (
                  <div className="space-y-3 text-sm">
                    <p className="text-t-text leading-relaxed font-medium">
                      请核对双向换盘商谈后确认撤销（卖盘 + 买盘）。
                    </p>
                    <CounterOfferConfirmSheetFromCo
                      co={sellCo}
                      productName={productName}
                      serialLabel={formatBoardSerial("S", sellCo.ref_serial_no, sellCo.ref_created_at)}
                    />
                    <CounterOfferConfirmSheetFromCo
                      co={buyCo}
                      productName={productName}
                    />
                    <p className="text-[11px] text-t-text-3 leading-relaxed">
                      撤销后对方将看到「已撤销」状态。
                    </p>
                  </div>
                ),
                wide: true,
                variant: "warning",
                icon: "warning",
                confirmText: "撤销",
              })) return;
              onCancel(sellCo.id);
              onCancel(buyCo.id);
            }}
            disabled={cancelPending}
            className="text-xs px-2.5 py-1 rounded bg-t-hover text-t-text-2"
          >
            撤销双向商谈
          </button>
        ) : (
          <span className="text-xs text-t-text-3">-</span>
        )}
      </td>
    </tr>
  );
}
