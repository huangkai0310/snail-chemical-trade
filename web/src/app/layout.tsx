import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import Header from "@/components/Header";
import ToastContainer from "@/components/Toast";
import GlobalNotificationListener from "@/components/GlobalNotificationListener";
import RouteMemory from "@/components/RouteMemory";

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
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 首屏前恢复主题，避免重开闪回白天 / 暗色错位 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("snailchem_theme");if(t!=="light"&&t!=="dark")t="dark";document.documentElement.setAttribute("data-theme",t);document.documentElement.style.colorScheme=t;}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`,
          }}
        />
      </head>
      <body>
        <Providers>
          <GlobalNotificationListener />
          <RouteMemory />
          <Header />
          {children}
          <ToastContainer />
        </Providers>
      </body>
    </html>
  );
}
