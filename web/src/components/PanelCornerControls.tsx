import React from "react";

interface Props {
  title?: string;
  onToggleVisible?: () => void;
  onClose?: () => void;
  onToggleLock?: () => void;
  isLocked?: boolean;
  isVisible?: boolean;
  showLock?: boolean;
  showEye?: boolean;
  showClose?: boolean;
  className?: string;
}

export default function PanelCornerControls({
  title,
  onToggleVisible,
  onClose,
  onToggleLock,
  isLocked = false,
  isVisible = true,
  showLock = true,
  showEye = true,
  showClose = true,
  className = "",
}: Props) {
  return (
    <div className={`flex items-center justify-between px-2 py-1 border-b border-t-border bg-t-panel shrink-0 ${className}`}>
      <div className="flex items-center gap-1.5">
        {title && (
          <span className="text-xs font-semibold text-t-text-2">
            {title}
          </span>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        {showEye && onToggleVisible && (
          <button
            onClick={onToggleVisible}
            title={isVisible ? "隐藏面板" : "显示面板"}
            className={`p-1 rounded hover:bg-t-hover transition-colors ${
              isVisible ? "text-t-text-3" : "text-t-text-3/40"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>
        )}
        {showLock && onToggleLock && (
          <button
            onClick={onToggleLock}
            title={isLocked ? "解锁面板" : "锁定面板"}
            className={`p-1 rounded hover:bg-t-hover transition-colors ${
              isLocked ? "text-red-400" : "text-t-text-3"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill={isLocked ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </button>
        )}
        {showClose && onClose && (
          <button
            onClick={onClose}
            title="关闭面板"
            disabled={isLocked}
            className={`p-1 rounded hover:bg-red-500/10 transition-colors ${
              isLocked ? "text-t-text-3/30 cursor-not-allowed" : "text-t-text-3 hover:text-red-400"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
