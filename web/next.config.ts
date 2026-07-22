import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 静态导出（部署到 nginx）
  output: "export",
  // 静态导出时禁用 Image Optimization API
  images: { unoptimized: true },

  // 本地开发时将 /api 代理到后端服务器，避免 CORS
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "https://api.snailchemical.com/api/:path*",
      },
    ];
  },
};

export default nextConfig;
