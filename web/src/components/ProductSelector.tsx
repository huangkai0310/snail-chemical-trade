"use client";

import type { Product } from "@/lib/types";
import { getProductSymbol } from "@/lib/types";

interface Props {
  products: Product[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export default function ProductSelector({ products, selectedId, onSelect }: Props) {
  if (products.length === 0) {
    return (
      <div className="flex items-center gap-1 bg-white rounded-lg p-3 shadow-sm border border-gray-200 text-gray-400 text-sm">
        加载产品中...
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 bg-white rounded-lg p-1 shadow-sm border border-gray-200 flex-wrap">
      {products.map((p) => (
        <button
          key={p.id}
          onClick={() => onSelect(p.id)}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            selectedId === p.id
              ? "bg-brand-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          {p.name}
          <span className="ml-1 text-xs opacity-70">{getProductSymbol(p)}</span>
        </button>
      ))}
    </div>
  );
}
