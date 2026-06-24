"use client";

import { useState, useMemo } from "react";
import ProductSelector from "@/components/ProductSelector";
import ListingTable from "@/components/ListingTable";
import CreateListingModal, { type CreateListingData } from "@/components/CreateListingModal";
import { products, fakeListings } from "@/lib/fake-data";
import type { Listing } from "@/lib/types";

export default function Home() {
  const [productId, setProductId] = useState("methanol");
  const [modalOpen, setModalOpen] = useState(false);
  const [listings, setListings] = useState<Listing[]>(fakeListings);

  const filtered = useMemo(
    () => listings.filter((l) => l.productId === productId),
    [listings, productId]
  );

  const buyListings = useMemo(
    () => filtered
      .filter((l) => l.side === "buy")
      .sort((a, b) => b.price - a.price),
    [filtered]
  );

  const sellListings = useMemo(
    () => filtered
      .filter((l) => l.side === "sell")
      .sort((a, b) => a.price - b.price),
    [filtered]
  );

  const selectedProduct = products.find((p) => p.id === productId);

  const handleCreate = (data: CreateListingData) => {
    const product = products.find((p) => p.id === data.productId);
    const newListing: Listing = {
      id: `new-${Date.now()}`,
      productId: data.productId,
      productName: product?.name ?? data.productId,
      side: data.side,
      price: Number(data.price),
      quantity: Number(data.quantity),
      unit: "吨",
      deliveryPeriod: data.deliveryPeriod,
      deliveryLocation: data.deliveryLocation,
      specs: data.specs || "-",
      companyName: data.companyName || "未知企业",
      createdAt: new Date().toISOString(),
    };
    setListings((prev) => [newListing, ...prev]);
  };

  return (
    <main className="max-w-7xl mx-auto px-4 py-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">
            交易大厅
          </h1>
          {selectedProduct && (
            <p className="text-sm text-gray-500 mt-1">
              {selectedProduct.name} ({selectedProduct.symbol}) — 共 {filtered.length} 条挂牌信息
            </p>
          )}
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg transition-colors shadow-sm text-sm"
        >
          + 发布挂牌
        </button>
      </div>

      {/* Product selector tabs */}
      <div className="mb-6 overflow-x-auto">
        <ProductSelector
          products={products}
          selectedId={productId}
          onSelect={setProductId}
        />
      </div>

      {/* Two-column listing tables */}
      <div className="flex flex-col lg:flex-row gap-6">
        <ListingTable listings={buyListings} side="buy" />
        <ListingTable listings={sellListings} side="sell" />
      </div>

      {/* Create listing modal */}
      <CreateListingModal
        open={modalOpen}
        products={products}
        onClose={() => setModalOpen(false)}
        onSubmit={handleCreate}
      />
    </main>
  );
}
