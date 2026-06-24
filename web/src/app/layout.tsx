import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "化工交易平台 - Snail Chemical Trade",
  description: "化工产品量化交易撮合平台，数据驱动的化工大宗商品电子交易市场",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        {/* Top Nav */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold text-sm">
                化
              </div>
              <span className="font-bold text-gray-800 text-lg">化工交易平台</span>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">MVP</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>行情</span>
              <span className="text-brand-600 font-medium">交易大厅</span>
              <span>资讯</span>
            </div>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
