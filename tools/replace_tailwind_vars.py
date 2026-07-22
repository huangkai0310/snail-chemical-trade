#!/usr/bin/env python3
"""Replace Tailwind arbitrary-value CSS variable classes with registered alias classes."""

import re
import os
import glob

REPLACEMENTS = [
    # Background layers (longest match first)
    ("bg-[var(--bg-primary)]", "bg-t-bg"),
    ("bg-[var(--bg-secondary)]", "bg-t-panel"),
    ("bg-[var(--bg-panel)]", "bg-t-panel"),
    ("bg-[var(--bg-card)]", "bg-t-card"),
    ("bg-[var(--bg-tertiary)]", "bg-t-tertiary"),
    ("bg-[var(--bg-elevated)]", "bg-t-card"),
    ("bg-[var(--bg-hover)]", "bg-t-hover"),
    ("bg-[var(--bg-active)]", "bg-t-active"),
    ("bg-[var(--bg-input)]", "bg-t-input"),
    ("bg-[var(--bg-base)]", "bg-t-bg"),  # legacy alias

    # Text colors
    ("text-[var(--text-primary)]", "text-t-text"),
    ("text-[var(--text-secondary)]", "text-t-text-2"),
    ("text-[var(--text-muted)]", "text-t-text-3"),
    ("text-[var(--text-disabled)]", "text-t-text-disabled"),

    # Border colors (with optional opacity modifier)
    ("border-[var(--border-color)]/50", "border-t-border/50"),
    ("border-[var(--border-color)]/40", "border-t-border/40"),
    ("border-[var(--border-color)]/70", "border-t-border/70"),
    ("border-[var(--border-color)]", "border-t-border"),
    ("border-[var(--border-subtle)]", "border-t-border-subtle"),
    ("border-[var(--border-strong)]", "border-t-border-strong"),

    # Accent colors
    ("bg-[var(--accent)]", "bg-t-accent"),
    ("hover:bg-[var(--accent-hover)]", "hover:bg-t-accent-hover"),
    ("hover:bg-[var(--accent)]", "hover:bg-t-accent-hover"),
    ("bg-[var(--accent-hover)]", "bg-t-accent-hover"),
    ("bg-[var(--accent-bg)]", "bg-t-accent-bg"),
    ("ring-[var(--accent-border)]", "ring-t-accent-border"),
    ("border-[var(--accent)]", "border-t-accent"),
    ("focus:border-[var(--accent)]", "focus:border-t-accent"),

    # Trading colors — up (red)
    ("text-[var(--color-up)]", "text-trade-up"),
    ("bg-[var(--color-up)]", "bg-trade-up"),
    ("bg-[var(--color-up-bg)]", "bg-trade-up-bg"),
    ("text-[var(--color-up-text)]", "text-trade-up-text"),

    # Trading colors — down (green)
    ("text-[var(--color-down)]", "text-trade-down"),
    ("bg-[var(--color-down)]", "bg-trade-down"),
    ("bg-[var(--color-down-bg)]", "bg-trade-down-bg"),
    ("text-[var(--color-down-text)]", "text-trade-down-text"),

    # Status colors — info
    ("text-[var(--color-info)]", "text-status-info"),
    ("bg-[var(--color-info-bg)]", "bg-status-info-bg"),

    # Status colors — warning
    ("text-[var(--color-warning)]", "text-status-warning"),
    ("bg-[var(--color-warning-bg)]", "bg-status-warning-bg"),
    ("text-[var(--color-warning-text)]", "text-t-warning-text"),

    # Status colors — success
    ("text-[var(--color-success)]", "text-status-success"),
    ("bg-[var(--color-success-bg)]", "bg-status-success-bg"),
    ("text-[var(--color-success-text)]", "text-t-success-text"),

    # Status colors — error
    ("text-[var(--color-error)]", "text-status-error"),
    ("bg-[var(--color-error)]", "bg-status-error"),
    ("bg-[var(--color-error-bg)]", "bg-status-error-bg"),
]


def replace_in_file(filepath: str) -> tuple[int, list[str]]:
    """Replace all CSS variable arbitrary values in a file. Returns (count, changes)."""
    with open(filepath, "r", encoding="utf-8") as f:
        original = f.read()

    content = original
    changes = []
    total_count = 0

    for old, new in REPLACEMENTS:
        count = content.count(old)
        if count > 0:
            content = content.replace(old, new)
            total_count += count
            changes.append(f"  {old} → {new} ({count}x)")

    if content != original:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)

    return total_count, changes


def main():
    src_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "web", "src"
    )

    tsx_files = glob.glob(os.path.join(src_dir, "**", "*.tsx"), recursive=True)
    tsx_files += glob.glob(os.path.join(src_dir, "**", "*.ts"), recursive=True)
    css_files = glob.glob(os.path.join(src_dir, "**", "*.css"), recursive=True)

    all_files = tsx_files + css_files
    grand_total = 0

    for filepath in sorted(all_files):
        count, changes = replace_in_file(filepath)
        if count > 0:
            grand_total += count
            rel = os.path.relpath(filepath, src_dir)
            print(f"\n{rel} ({count} replacements):")
            for c in changes:
                print(c)

    print(f"\n{'='*60}")
    print(f"Total: {grand_total} replacements across all files")

    # Check for remaining var() usages
    print(f"\n{'='*60}")
    print("Checking for remaining var() arbitrary values in className...")
    remaining = 0
    for filepath in sorted(all_files):
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        # Find remaining var() in className strings
        matches = re.findall(r'className[=][{"]?(.*?var\(--[^)]+\).*?)[}"]', content)
        if matches:
            for m in matches:
                if "displayName" not in m:  # skip React displayName
                    print(f"  {os.path.relpath(filepath, src_dir)}: \"{m.strip()[:100]}\"")
                    remaining += 1

    if remaining == 0:
        print("  NONE — all clean!")

if __name__ == "__main__":
    main()
