"use client";

interface Props {
  value: string;
  maxShares: number;
  perShare: number;
  unit?: string;
  label?: string;
  error?: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange: (v: string) => void;
  onBlur?: () => void;
}

/** 按份数选择：± 调节份数，展示对应数量 */
export default function ShareCountPicker({
  value,
  maxShares,
  perShare,
  unit = "吨",
  label = "份数",
  error,
  disabled,
  autoFocus,
  onChange,
  onBlur,
}: Props) {
  const n = Math.floor(Number(value) || 0);
  const qty = n > 0 && perShare > 0 ? n * perShare : 0;

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-600 dark:text-t-text-2">
        {label}
        <span className="ml-2 text-xs font-normal text-t-text-3">
          每份 {perShare.toLocaleString()} {unit} · 最多 {maxShares} 份
        </span>
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled || n <= 1}
          onClick={() => onChange(String(Math.max(1, n - 1)))}
          className="w-10 h-10 rounded-lg border border-t-border text-t-text-2 hover:bg-t-hover disabled:opacity-40 text-lg leading-none"
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={maxShares}
          step={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          autoFocus={autoFocus}
          disabled={disabled}
          className={`flex-1 px-3 py-2.5 border rounded-lg focus:outline-none focus:ring-2 font-mono text-center dark:bg-t-input dark:text-t-text ${
            error
              ? "border-red-400 focus:ring-red-200"
              : "border-gray-200 dark:border-t-border focus:ring-brand-500"
          }`}
        />
        <button
          type="button"
          disabled={disabled || n >= maxShares}
          onClick={() => onChange(String(Math.min(maxShares, Math.max(1, n) + 1)))}
          className="w-10 h-10 rounded-lg border border-t-border text-t-text-2 hover:bg-t-hover disabled:opacity-40 text-lg leading-none"
        >
          +
        </button>
      </div>
      <div className="text-sm text-gray-600 dark:text-t-text-2 flex justify-between">
        <span>对应数量</span>
        <span className="font-mono font-medium text-t-text">
          {qty > 0 ? `${qty.toLocaleString()} ${unit}` : "—"}
        </span>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
