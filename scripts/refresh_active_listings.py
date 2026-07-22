#!/usr/bin/env python3
"""
刷新活跃挂牌（不清除已有数据）
用途：当订单簿因过期清理变空时，快速补充一批 OPEN/PARTIAL 挂牌，用于演示盘口。
只插入 listings 数据，不处理保证金/账户流水（避免余额不足导致事务回滚）。
执行后会自动重启 snail-api 服务以重新加载订单簿。
"""
import datetime
import os
import random
import subprocess
import tempfile
import uuid

# SSH 配置
SSH_HOST = "115.159.64.125"
SSH_USER = "root"
REMOTE_SQL_PATH = "/tmp/refresh_active_listings.sql"
DB_NAME = "snailtrade"
DB_USER = "snailtrade"
DB_PASS = "snailtrade2024"

PRODUCTS = [
    {"id": "benzene",     "name": "纯苯",       "base_price": 8000,  "volatility": 0.015},
    {"id": "propylene",   "name": "丙烯",       "base_price": 6500,  "volatility": 0.018},
    {"id": "phenol",      "name": "苯酚",       "base_price": 9000,  "volatility": 0.02},
    {"id": "acetone",     "name": "丙酮",       "base_price": 5500,  "volatility": 0.022},
    {"id": "isopropanol", "name": "异丙醇",     "base_price": 7500,  "volatility": 0.025},
    {"id": "mibk",        "name": "甲基异丁基酮", "base_price": 12000, "volatility": 0.03},
]
DELIVERY_PERIODS = [
    "现货", "2607上", "2607下", "2608上", "2608下",
    "2609上", "2609下", "2610上", "2610下",
]
DELIVERY_LOCATIONS = [
    "华东仓库-上海", "华东仓库-宁波", "华南仓库-广州",
    "华北仓库-天津", "华中仓库-武汉", "西南仓库-成都",
]


def rand_price(mid: float, vol: float) -> float:
    spread = random.uniform(0.003, vol)
    return round(round(mid * (1 + random.choice([-1, 1]) * spread) / 5) * 5, 2)


def q(s: str | None) -> str:
    return "NULL" if not s else f"'{s}'"


def fmt_time(dt: datetime.datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def ssh_cmd(cmd: str) -> None:
    args = ["ssh", "-o", "StrictHostKeyChecking=no", f"{SSH_USER}@{SSH_HOST}", cmd]
    subprocess.run(args, check=True)


def build_sql() -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    lines = [
        "BEGIN;",
        "",
        "-- 获取交易员 user_id 列表",
        "CREATE TEMP TABLE IF NOT EXISTS _tmp_traders (uid UUID);",
        "DELETE FROM _tmp_traders;",
        "INSERT INTO _tmp_traders",
        "SELECT id FROM users WHERE username LIKE 'trader_%';",
        "",
        "-- 插入新的 OPEN 挂牌（只插入 listings，不处理保证金）",
        "INSERT INTO listings (id, user_id, product_id, side, price, quantity, filled, status, delivery_period, delivery_location, allow_partial, min_quantity, created_at, updated_at)",
        "VALUES",
    ]

    listing_rows = []
    for product in PRODUCTS:
        mid = product["base_price"]
        pid = product["id"]
        for side_tag, sign in [("BUY", -1), ("SELL", 1)]:
            for _ in range(random.randint(5, 8)):
                spread = random.uniform(0.003, 0.04) * random.randint(1, 5)
                p = round(round(mid * (1 + sign * spread) / 5) * 5, 2)
                qty = random.randint(20, 300)
                dp = random.choice(DELIVERY_PERIODS)
                dl = random.choice(DELIVERY_LOCATIONS)
                lid = str(uuid.uuid4())
                ap = random.choices([True, False], weights=[75, 25])[0]
                mq = random.randint(5, max(5, int(qty * 0.3))) if ap else qty
                ts = now - datetime.timedelta(minutes=random.randint(1, 120))

                listing_rows.append(
                    f"('{lid}', (SELECT uid FROM _tmp_traders ORDER BY random() LIMIT 1), '{pid}', "
                    f"'{side_tag}', {p}, {qty}, 0, 'OPEN', {q(dp)}, {q(dl)}, "
                    f"{'true' if ap else 'false'}, {mq}, '{fmt_time(ts)}', '{fmt_time(ts)}')"
                )

    lines.append(",\n".join(listing_rows) + ";")

    lines += [
        "",
        "-- 补充少量 PARTIAL 挂牌",
        "INSERT INTO listings (id, user_id, product_id, side, price, quantity, filled, status, delivery_period, delivery_location, allow_partial, min_quantity, created_at, updated_at)",
        "VALUES",
    ]

    partial_rows = []
    for product in PRODUCTS:
        mid = product["base_price"]
        pid = product["id"]
        for _ in range(random.randint(1, 3)):
            p = rand_price(mid, product["volatility"])
            qty = random.randint(80, 500)
            filled = random.randint(int(qty * 0.15), int(qty * 0.75))
            side = random.choice(["BUY", "SELL"])
            dp = random.choice(DELIVERY_PERIODS)
            dl = random.choice(DELIVERY_LOCATIONS)
            lid = str(uuid.uuid4())
            ap = random.choices([True, False], weights=[80, 20])[0]
            mq = random.randint(5, max(5, int(qty * 0.3))) if ap else qty
            ts = now - datetime.timedelta(minutes=random.randint(10, 240))
            partial_rows.append(
                f"('{lid}', (SELECT uid FROM _tmp_traders ORDER BY random() LIMIT 1), '{pid}', "
                f"'{side}', {p}, {qty}, {filled}, 'PARTIAL', {q(dp)}, {q(dl)}, "
                f"{'true' if ap else 'false'}, {mq}, '{fmt_time(ts)}', '{fmt_time(ts)}')"
            )
    lines.append(",\n".join(partial_rows) + ";")

    lines += [
        "",
        "COMMIT;",
        "",
        "-- 统计",
        "SELECT product_id, side, status, COUNT(*) FROM listings WHERE status IN ('OPEN','PARTIAL') GROUP BY product_id, side, status ORDER BY product_id, side;",
    ]
    return "\n".join(lines)


def main():
    sql = build_sql()
    local_path = os.path.join(tempfile.gettempdir(), "refresh_active_listings.sql")
    with open(local_path, "w", encoding="utf-8") as f:
        f.write(sql)

    print(f"SQL 文件已生成: {local_path}")
    print(f"共 {len(sql.splitlines())} 行 SQL")

    # 上传到服务器
    subprocess.run([
        "scp", "-o", "StrictHostKeyChecking=no",
        local_path, f"{SSH_USER}@{SSH_HOST}:{REMOTE_SQL_PATH}"
    ], check=True)

    # 执行 SQL（使用 TCP 连接）
    ssh_cmd(f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} -f {REMOTE_SQL_PATH}")

    # 重启服务以重新加载订单簿
    ssh_cmd("systemctl restart snail-api")

    print("✅ 活跃挂牌已刷新，snail-api 已重启")


if __name__ == "__main__":
    main()
