"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAccount, deposit, withdraw, fetchTransactions } from "@/lib/api";
import { sanitizeText, isSafeInput } from "@/lib/validate";
import type { Transaction } from "@/lib/types";

const TX_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  DEPOSIT:      { label: "充值",     color: "text-green-400" },
  WITHDRAW:     { label: "提现",     color: "text-yellow-400" },
  FREEZE:       { label: "冻结保证金", color: "text-orange-400" },
  UNFREEZE:     { label: "解冻保证金", color: "text-blue-400" },
  TRADE_DEDUCT: { label: "成交扣款", color: "text-red-400" },
  TRADE_INCOME: { label: "成交收款", color: "text-emerald-400" },
  REFUND:       { label: "退款",     color: "text-cyan-400" },
};

export default function AccountPanel() {
  const qc = useQueryClient();
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [amount, setAmount] = useState("");
  const [remark, setRemark] = useState("");
  const [txPage, setTxPage] = useState(1);
  const [errorMsg, setErrorMsg] = useState("");

  const { data: account, isLoading: accLoading } = useQuery({
    queryKey: ["account"],
    queryFn: fetchAccount,
    retry: 1,
  });

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ["transactions", txPage],
    queryFn: () => fetchTransactions(txPage, 10),
    retry: 1,
  });

  const depositMut = useMutation({
    mutationFn: () => deposit(parseFloat(amount), remark || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      setAmount("");
      setRemark("");
      setShowDeposit(false);
      setErrorMsg("");
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const withdrawMut = useMutation({
    mutationFn: () => withdraw(parseFloat(amount), remark || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      setAmount("");
      setRemark("");
      setShowWithdraw(false);
      setErrorMsg("");
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const handleConfirm = useCallback(() => {
    setErrorMsg("");
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) {
      setErrorMsg("请输入大于 0 的金额");
      return;
    }
    if (val > 100000000) {
      setErrorMsg("金额不能超过 1 亿元");
      return;
    }
    if (remark && !isSafeInput(remark)) {
      setErrorMsg("备注包含非法字符");
      return;
    }
    if (showDeposit) depositMut.mutate();
    else withdrawMut.mutate();
  }, [amount, remark, showDeposit, depositMut, withdrawMut]);

  const cancelModal = () => {
    setShowDeposit(false);
    setShowWithdraw(false);
    setAmount("");
    setRemark("");
    setErrorMsg("");
  };

  return (
    <div className="space-y-4">
      {/* 账户卡片 */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3040] p-5">
        <h3 className="text-sm font-semibold text-[#8899aa] uppercase tracking-widest mb-4">
          资金账户
        </h3>

        {accLoading ? (
          <div className="text-[#556677] text-sm animate-pulse">加载中…</div>
        ) : account ? (
          <div className="space-y-3">
            {/* 余额卡 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#0f1520] rounded-lg p-3 border border-[#2a3040]">
                <div className="text-xs text-[#8899aa] mb-1">可用余额</div>
                <div className="text-xl font-bold text-green-400">
                  ¥{account.balance.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="bg-[#0f1520] rounded-lg p-3 border border-[#2a3040]">
                <div className="text-xs text-[#8899aa] mb-1">保证金冻结</div>
                <div className="text-xl font-bold text-orange-400">
                  ¥{account.frozen.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-[#0f1520] rounded-lg p-2.5 border border-[#2a3040]">
                <span className="text-[#8899aa]">累计入账 </span>
                <span className="text-green-300">
                  ¥{account.total_in.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-[#0f1520] rounded-lg p-2.5 border border-[#2a3040]">
                <span className="text-[#8899aa]">累计出账 </span>
                <span className="text-red-300">
                  ¥{account.total_out.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setShowDeposit(true); setShowWithdraw(false); }}
                className="flex-1 py-2 rounded-lg bg-green-500/20 hover:bg-green-500/30 border border-green-500/40 text-green-400 text-sm font-medium transition-colors"
              >
                + 充值
              </button>
              <button
                onClick={() => { setShowWithdraw(true); setShowDeposit(false); }}
                className="flex-1 py-2 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/40 text-yellow-400 text-sm font-medium transition-colors"
              >
                − 提现
              </button>
            </div>
          </div>
        ) : (
          <div className="text-[#556677] text-sm">账户信息不可用</div>
        )}
      </div>

      {/* 充值/提现弹窗 */}
      {(showDeposit || showWithdraw) && (
        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3040] p-4">
          <h4 className="text-sm font-semibold text-white mb-3">
            {showDeposit ? "充值" : "提现"}
          </h4>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-[#8899aa] mb-1">金额（元）</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="请输入金额"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-[#0f1520] border border-[#2a3040] rounded-lg px-3 py-2 text-sm text-white placeholder-[#445566] focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-[#8899aa] mb-1">备注（可选）</label>
              <input
                type="text"
                placeholder="如：银行转账"
                value={remark}
                onChange={(e) => setRemark(sanitizeText(e.target.value))}
                className="w-full bg-[#0f1520] border border-[#2a3040] rounded-lg px-3 py-2 text-sm text-white placeholder-[#445566] focus:outline-none focus:border-blue-500"
              />
            </div>
            {errorMsg && (
              <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
                {errorMsg}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleConfirm}
                disabled={depositMut.isPending || withdrawMut.isPending}
                className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {(depositMut.isPending || withdrawMut.isPending) ? "处理中…" : "确认"}
              </button>
              <button
                onClick={cancelModal}
                className="px-4 py-2 rounded-lg bg-[#0f1520] hover:bg-[#2a3040] border border-[#2a3040] text-[#8899aa] text-sm transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 资金流水 */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3040] p-5">
        <h3 className="text-sm font-semibold text-[#8899aa] uppercase tracking-widest mb-4">
          资金流水
        </h3>

        {txLoading ? (
          <div className="text-[#556677] text-sm animate-pulse">加载中…</div>
        ) : !txData || txData.data.length === 0 ? (
          <div className="text-center py-8 text-[#445566] text-sm">暂无流水记录</div>
        ) : (
          <div className="space-y-2">
            {txData.data.map((tx: Transaction) => {
              const meta = TX_TYPE_LABELS[tx.type] ?? { label: tx.type, color: "text-gray-400" };
              const isIn = ["DEPOSIT", "UNFREEZE", "TRADE_INCOME", "REFUND"].includes(tx.type);
              return (
                <div key={tx.id} className="flex items-center gap-3 py-2.5 border-b border-[#1e2535] last:border-0">
                  {/* 类型标签 */}
                  <div className={`text-xs font-medium min-w-[72px] ${meta.color}`}>
                    {meta.label}
                  </div>
                  {/* 金额 */}
                  <div className={`text-sm font-bold flex-1 ${isIn ? "text-green-400" : "text-red-400"}`}>
                    {isIn ? "+" : "−"}¥{tx.amount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                  </div>
                  {/* 余额变化 */}
                  <div className="text-xs text-[#556677]">
                    余额 ¥{tx.balance_after.toFixed(2)}
                  </div>
                  {/* 时间 */}
                  <div className="text-xs text-[#445566] min-w-[80px] text-right">
                    {new Date(tx.created_at).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              );
            })}

            {/* 分页 */}
            {txData.total_page > 1 && (
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                  disabled={txPage <= 1}
                  className="text-xs text-[#8899aa] hover:text-white disabled:opacity-30 px-2 py-1 rounded border border-[#2a3040] transition-colors"
                >
                  ← 上页
                </button>
                <span className="text-xs text-[#556677]">
                  第 {txPage}/{txData.total_page} 页 · 共 {txData.total} 条
                </span>
                <button
                  onClick={() => setTxPage((p) => Math.min(txData.total_page, p + 1))}
                  disabled={txPage >= txData.total_page}
                  className="text-xs text-[#8899aa] hover:text-white disabled:opacity-30 px-2 py-1 rounded border border-[#2a3040] transition-colors"
                >
                  下页 →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
