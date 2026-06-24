"use client";

import type { Product } from "@/lib/types";

interface Props {
  products: Product[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export default function ProductSelector({ products, selectedId, onSelect }: Props) {
  return (
    <div className="flex items-center gap-1 bg-white rounded-lg p-1 shadow-sm border border-gray-200">
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
          <span className="ml-1 text-xs opacity-70">{p.symbol}</span>
        </button>
      ))}
    </div>
  );
}
