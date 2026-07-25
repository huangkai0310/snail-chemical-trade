"""定时数据采集 cron 入口脚本。

用法:
    python scripts/cron_collect.py                    # 默认采集 platform 全部活跃品种
    python scripts/cron_collect.py --product benzene  # 只采集苯
    python scripts/cron_collect.py --interval 1h      # 1小时周期
    python scripts/cron_collect.py --period 现货       # 只采现货

也可配置 crontab/systemd timer 每小时自动调用:
    0 * * * * cd /opt/snailtrade && python scripts/cron_collect.py >> /var/log/crawler/cron.log 2>&1
"""

from __future__ import annotations

import logging
import os
import sys
import time
from pathlib import Path

# ── 确保 crawler 包可导入 ──────────────────────────────────
# scripts/ 在 data/crawler/ 下，src/ 是包根
_SCRIPT_DIR = Path(__file__).resolve().parent
_CRAWLER_ROOT = _SCRIPT_DIR.parent
_SRC_DIR = _CRAWLER_ROOT / "src"

if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from crawler.collect import run_collect  # noqa: E402
from crawler.config import INTERVALS, warehouse_dir  # noqa: E402

# ── 日志 ────────────────────────────────────────────────────
LOG_FORMAT = "%(asctime)s [%(levelname)s] %(message)s"

logger = logging.getLogger("crawler.cron")


def setup_logging(log_dir: Path | None = None, level: int = logging.INFO) -> None:
    """配置日志: stdout + 可选文件。"""
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]
    if log_dir:
        log_dir.mkdir(parents=True, exist_ok=True)
        handlers.append(
            logging.FileHandler(log_dir / "cron_collect.log", encoding="utf-8")
        )
    logging.basicConfig(level=level, format=LOG_FORMAT, handlers=handlers)


# ── 默认参数 ─────────────────────────────────────────────────
DEFAULT_SOURCE = "platform"
DEFAULT_INTERVAL = "1d"
DEFAULT_PERIOD = "现货"
DEFAULT_LIMIT = 120
MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 30


def collect_once(
    source: str = DEFAULT_SOURCE,
    product_id: str | None = None,
    all_products: bool = True,
    period: str = DEFAULT_PERIOD,
    interval: str = DEFAULT_INTERVAL,
    limit: int = DEFAULT_LIMIT,
) -> bool:
    """执行一次采集，返回是否成功。"""
    try:
        result = run_collect(
            source,
            product_id=product_id,
            delivery_period=period,
            interval=interval,
            limit=limit,
            all_products=all_products,
        )
        logger.info(
            "采集成功: source=%s ohlcv_rows=%d ohlcv_files=%d snapshot_rows=%d",
            result.source,
            result.ohlcv_rows,
            len(result.ohlcv_paths),
            result.snapshot_rows,
        )
        return True
    except Exception as exc:
        logger.error("采集失败: %s", exc, exc_info=True)
        return False


def collect_with_retry(
    source: str = DEFAULT_SOURCE,
    product_id: str | None = None,
    all_products: bool = True,
    period: str = DEFAULT_PERIOD,
    interval: str = DEFAULT_INTERVAL,
    limit: int = DEFAULT_LIMIT,
    max_retries: int = MAX_RETRIES,
    retry_delay: int = RETRY_DELAY_SECONDS,
) -> bool:
    """带重试的采集: 失败后等待 retry_delay 再试，最多 max_retries 次。"""
    for attempt in range(1, max_retries + 1):
        logger.info("开始采集 (attempt %d/%d)", attempt, max_retries)
        if collect_once(source, product_id, all_products, period, interval, limit):
            return True
        if attempt < max_retries:
            logger.warning("等待 %ds 后重试...", retry_delay)
            time.sleep(retry_delay)
    logger.error("全部 %d 次采集尝试均失败", max_retries)
    return False


# ── CLI ──────────────────────────────────────────────────────
def main() -> None:
    """简易命令行入口 (不依赖 click，避免安装依赖冲突)。"""
    import argparse

    parser = argparse.ArgumentParser(description="定时数据采集 cron 入口")
    parser.add_argument("--source", "-s", default=DEFAULT_SOURCE, help="数据源")
    parser.add_argument("--product", "-p", default=None, help="品种 ID，如 benzene")
    parser.add_argument("--all", dest="all_products", action="store_true", default=True,
                        help="采集全部活跃品种 (默认)")
    parser.add_argument("--period", default=DEFAULT_PERIOD, help="交割期")
    parser.add_argument("--interval", "-i", default=DEFAULT_INTERVAL,
                        choices=INTERVALS, help="K 线周期")
    parser.add_argument("--limit", "-n", type=int, default=DEFAULT_LIMIT, help="K 线条数上限")
    parser.add_argument("--retries", type=int, default=MAX_RETRIES, help="最大重试次数")
    parser.add_argument("--retry-delay", type=int, default=RETRY_DELAY_SECONDS,
                        help="重试间隔秒数")
    parser.add_argument("--log-dir", default=None,
                        help="日志目录 (默认只 stdout)")
    parser.add_argument("--quiet", action="store_true", help="只输出 warning 及以上")

    args = parser.parse_args()

    level = logging.WARNING if args.quiet else logging.INFO
    log_dir = Path(args.log_dir) if args.log_dir else None
    setup_logging(log_dir, level)

    logger.info("warehouse = %s", warehouse_dir())

    success = collect_with_retry(
        source=args.source,
        product_id=args.product,
        all_products=args.all_products,
        period=args.period,
        interval=args.interval,
        limit=args.limit,
        max_retries=args.retries,
        retry_delay=args.retry_delay,
    )

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
