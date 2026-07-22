"use client";

import React from "react";

interface State {
  hasError: boolean;
  error: Error | null;
  info: React.ErrorInfo | null;
}

/** 全局错误边界：捕获子树渲染异常，展示可读错误信息 */
export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ info });
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-[calc(100vh-2.75rem)] bg-t-bg p-8">
          <div className="max-w-lg w-full bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-6 text-sm">
            <h2 className="text-base font-semibold text-red-700 dark:text-red-400 mb-2">页面加载出错</h2>
            <p className="text-red-600 dark:text-red-400 mb-4">
              {this.state.error?.message ?? "未知错误"}
            </p>
            <details className="text-xs text-gray-500 bg-gray-100 rounded p-3 mb-4 overflow-auto max-h-40">
              <summary className="cursor-pointer font-medium mb-1">错误详情（开发者查看）</summary>
              <pre className="whitespace-pre-wrap break-all">
                {this.state.error?.stack}
                {this.state.info?.componentStack}
              </pre>
            </details>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
