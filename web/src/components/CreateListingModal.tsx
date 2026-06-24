"use client";

import { useState } from "react";
import type { Product, ListingSide } from "@/lib/types";

interface Props {
  open: boolean;
  products: Product[];
  onClose: () => void;
  onSubmit: (data: CreateListingData) => void;
}

export interface CreateListingData {
  productId: string;
  side: ListingSide;
  price: string;
  quantity: string;
  deliveryPeriod: string;
  deliveryLocation: string;
  specs: string;
  companyName: string;
}

const initialState: CreateListingData = {
  productId: "",
  side: "buy",
  price: "",
  quantity: "",
  deliveryPeriod: "",
  deliveryLocation: "",
  specs: "",
  companyName: "",
};

export default function CreateListingModal({ open, products, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<CreateListingData>(initialState);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
    setForm(initialState);
    onClose();
  };

  const update = (field: keyof CreateListingData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const isValid = form.productId && form.price && form.quantity && form.deliveryPeriod && form.deliveryLocation;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-800">发布挂牌</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 买卖方向 */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">方向</label>
            <div className="flex gap-2">
              {(["buy", "sell"] as ListingSide[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => update("side", s)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                    form.side === s
                      ? s === "buy"
                        ? "border-red-400 bg-red-50 text-red-700"
                        : "border-green-400 bg-green-50 text-green-700"
                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  {s === "buy" ? "🟢 求购" : "🔴 销售"}
                </button>
              ))}
            </div>
          </div>

          {/* 产品 */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">产品</label>
            <select
              value={form.productId}
              onChange={(e) => update("productId", e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none bg-white"
            >
              <option value="">请选择产品</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.symbol})</option>
              ))}
            </select>
          </div>

          {/* 价格 + 数量 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">价格 (元/吨)</label>
              <input
                type="number"
                value={form.price}
                onChange={(e) => update("price", e.target.value)}
                placeholder="如 2450"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">数量 (吨)</label>
              <input
                type="number"
                value={form.quantity}
                onChange={(e) => update("quantity", e.target.value)}
                placeholder="如 1000"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
              />
            </div>
          </div>

          {/* 交割期 */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">交割期</label>
            <select
              value={form.deliveryPeriod}
              onChange={(e) => update("deliveryPeriod", e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none bg-white"
            >
              <option value="">请选择交割期</option>
              <option value="7月上">7月上</option>
              <option value="7月下">7月下</option>
              <option value="8月上">8月上</option>
              <option value="8月下">8月下</option>
              <option value="9月上">9月上</option>
              <option value="9月下">9月下</option>
            </select>
          </div>

          {/* 交割地 */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">交割地点</label>
            <input
              type="text"
              value={form.deliveryLocation}
              onChange={(e) => update("deliveryLocation", e.target.value)}
              placeholder="如 江苏张家港"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            />
          </div>

          {/* 规格 */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">产品规格</label>
            <input
              type="text"
              value={form.specs}
              onChange={(e) => update("specs", e.target.value)}
              placeholder="如 99.9% 工业级"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            />
          </div>

          {/* 企业名称 */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">企业名称</label>
            <input
              type="text"
              value={form.companyName}
              onChange={(e) => update("companyName", e.target.value)}
              placeholder="输入您的企业名称"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!isValid}
            className="w-full py-3 rounded-lg text-white font-bold text-sm transition-colors bg-brand-600 hover:bg-brand-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            确认发布
          </button>
        </form>
      </div>
    </div>
  );
}
