"""quant CLI。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import click

from quant.analysis import analyze, format_report_text
from quant.backtest import STRATEGIES, run_backtest
from quant.config import warehouse_dir
from quant.forecast import ewma_forecast
from quant.indicators import enrich_indicators
from quant.load import load_ohlcv


@click.group()
@click.version_option(package_name="quant")
def main() -> None:
    """化工产品量化分析。"""


@main.command("analyze")
@click.option("--product", "-p", "product_id", required=True, help="品种 ID")
@click.option("--interval", "-i", default="1d", show_default=True)
@click.option("--source", "-s", default=None, help="数据源；默认自动选择")
@click.option("--period", default="现货", show_default=True)
@click.option("--json-out", "json_out", default=None, help="写入 JSON 报告路径")
@click.option("--save/--no-save", default=True, show_default=True, help="写入 warehouse/reports")
def analyze_cmd(
    product_id: str,
    interval: str,
    source: str | None,
    period: str,
    json_out: str | None,
    save: bool,
) -> None:
    """波动率 / 动量 / 均线摘要分析。"""
    try:
        df = load_ohlcv(product_id, interval, source=source, delivery_period=period)
        report = analyze(df)
    except Exception as exc:  # noqa: BLE001
        click.echo(f"分析失败: {exc}", err=True)
        sys.exit(1)

    click.echo(format_report_text(report))
    click.echo()
    click.echo(json.dumps(report, ensure_ascii=False, indent=2))

    out_path: Path | None = Path(json_out) if json_out else None
    if save and out_path is None:
        reports = warehouse_dir() / "reports"
        reports.mkdir(parents=True, exist_ok=True)
        out_path = reports / f"{product_id}_{interval}_analysis.json"
    if out_path:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        click.echo(f"\n已写入 {out_path}")


@main.command("indicators")
@click.option("--product", "-p", "product_id", required=True)
@click.option("--interval", "-i", default="1d", show_default=True)
@click.option("--source", "-s", default=None)
@click.option("--period", default="现货", show_default=True)
@click.option("--out", "out_path", default=None, help="输出 CSV；默认写 warehouse/reports")
def indicators_cmd(
    product_id: str,
    interval: str,
    source: str | None,
    period: str,
    out_path: str | None,
) -> None:
    """导出带指标的 OHLCV CSV。"""
    try:
        df = load_ohlcv(product_id, interval, source=source, delivery_period=period)
        enriched = enrich_indicators(df)
    except Exception as exc:  # noqa: BLE001
        click.echo(f"计算失败: {exc}", err=True)
        sys.exit(1)

    path = Path(out_path) if out_path else (
        warehouse_dir() / "reports" / f"{product_id}_{interval}_indicators.csv"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    enriched.to_csv(path, index=False)
    click.echo(f"rows={len(enriched)} → {path}")


@main.command("forecast")
@click.option("--product", "-p", "product_id", required=True)
@click.option("--interval", "-i", default="1d", show_default=True)
@click.option("--source", "-s", default=None)
@click.option("--period", default="现货", show_default=True)
@click.option("--horizon", "-h", default=5, show_default=True, help="预测步数")
@click.option("--span", default=10, show_default=True, help="EWMA 跨度")
def forecast_cmd(
    product_id: str,
    interval: str,
    source: str | None,
    period: str,
    horizon: int,
    span: int,
) -> None:
    """EWMA 收益外推（研究用）。"""
    try:
        df = load_ohlcv(product_id, interval, source=source, delivery_period=period)
        result = ewma_forecast(df, horizon=horizon, span=span)
    except Exception as exc:  # noqa: BLE001
        click.echo(f"预测失败: {exc}", err=True)
        sys.exit(1)
    click.echo(json.dumps(result, ensure_ascii=False, indent=2))


@main.command("backtest")
@click.option("--product", "-p", "product_id", required=True)
@click.option("--interval", "-i", default="1d", show_default=True)
@click.option("--source", "-s", default=None)
@click.option("--period", default="现货", show_default=True)
@click.option(
    "--strategy",
    default="dual_ma",
    show_default=True,
    type=click.Choice(sorted(STRATEGIES.keys())),
)
@click.option("--fast", default=5, show_default=True, help="dual_ma 快线")
@click.option("--slow", default=20, show_default=True, help="dual_ma 慢线")
@click.option("--rsi-period", default=14, show_default=True)
@click.option("--oversold", default=30, show_default=True)
@click.option("--overbought", default=70, show_default=True)
@click.option("--fee-bps", default=5.0, show_default=True, help="单边费率（基点）")
@click.option("--save/--no-save", default=True, show_default=True)
def backtest_cmd(
    product_id: str,
    interval: str,
    source: str | None,
    period: str,
    strategy: str,
    fast: int,
    slow: int,
    rsi_period: int,
    oversold: float,
    overbought: float,
    fee_bps: float,
    save: bool,
) -> None:
    """策略回测（双均线 / RSI / MACD / 买入持有）。"""
    params: dict[str, float] = {
        "fast": fast,
        "slow": slow,
        "period": rsi_period,
        "oversold": oversold,
        "overbought": overbought,
    }
    try:
        df = load_ohlcv(product_id, interval, source=source, delivery_period=period)
        result = run_backtest(df, strategy=strategy, params=params, fee_bps=fee_bps)
    except Exception as exc:  # noqa: BLE001
        click.echo(f"回测失败: {exc}", err=True)
        sys.exit(1)

    m = result["metrics"]
    click.echo(
        f"{result['strategy_name']} | 收益 {m['total_return']*100:.2f}% | "
        f"持有 {m['buy_hold_return']*100:.2f}% | 回撤 {m['max_drawdown']*100:.2f}% | "
        f"夏普 {m['sharpe'] if m['sharpe'] is not None else 'n/a'} | 交易 {m['trade_count']}"
    )
    click.echo(json.dumps(result, ensure_ascii=False, indent=2))

    if save:
        reports = warehouse_dir() / "reports"
        reports.mkdir(parents=True, exist_ok=True)
        path = reports / f"{product_id}_{interval}_{strategy}_backtest.json"
        path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        click.echo(f"\n已写入 {path}")


if __name__ == "__main__":
    main()
