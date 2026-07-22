#!/usr/bin/env python3
"""生成模拟挂牌和成交数据的 SQL 脚本，用于填充今日行情 v2"""

from datetime import datetime, timedelta, timezone
import random

TZ = timezone(timedelta(hours=8))
random.seed(20260705)

USERS = [
    "2c51eba3-c20d-4257-9f8a-6ac5ab853a65",
    "0a9e1455-63af-498a-826e-768d7ca1ab13",
    "7ebf51d6-d637-47f2-8a60-59187ef5c5c7",
    "72480f6f-3a0d-4842-8ba5-5519658f55de",
    "bf112baa-1c36-4f97-81ac-debe02e742c3",
    "b426b42f-2c2c-4a03-8126-47d0e4b1893f",
]

PRODUCTS = [
    ("benzene", "纯苯", 7000),
    ("propylene", "丙烯", 6800),
    ("phenol", "苯酚", 8200),
    ("acetone", "丙酮", 5700),
    ("isopropanol", "异丙醇", 7500),
    ("mibk", "甲基异丁基酮", 11500),
]

LOCATIONS = ["华东", "华南", "华北", "华中", "张家港", "宁波港", "天津港", "青岛港"]

lines = ["\\timing on", "BEGIN;"]

listing_ids = {}

# === 每个品种 4 条买卖挂牌 ===
for prod_idx, (pid, pname, base) in enumerate(PRODUCTS):
    uid_sell = USERS[prod_idx % 3]
    uid_sell2 = USERS[(prod_idx + 3) % 6]
    uid_buy = USERS[(prod_idx + 1) % 6]
    uid_buy2 = USERS[(prod_idx + 4) % 6]

    prod_listings = []

    for i in range(2):
        lid = f"00000000-0000-0000-0000-{prod_idx:02d}{i:02d}00000001"
        price = base + random.randint(5, 60)
        qty = random.choice([100, 200, 300, 500])
        loc = random.choice(LOCATIONS)
        period = random.choice(["现货", "7月下", "8月上"])
        uid = uid_sell if i == 0 else uid_sell2
        lines.append(f"INSERT INTO listings (id, user_id, product_id, side, price, quantity, filled, status, delivery_period, delivery_location, margin_rate, allow_partial, min_quantity, created_at, updated_at)")
        lines.append(f"VALUES ('{lid}', '{uid}', '{pid}', 'SELL', {price}, {qty}, 0, 'OPEN', '{period}', '{loc}', 0.10, true, 10, now(), now());")
        prod_listings.append((lid, 'SELL', price, qty, uid))

    for i in range(2):
        lid = f"00000000-0000-0000-0000-{prod_idx:02d}{i+2:02d}00000001"
        price = base - random.randint(5, 60)
        qty = random.choice([100, 200, 300, 500])
        loc = random.choice(LOCATIONS)
        period = random.choice(["现货", "7月下", "8月上"])
        uid = uid_buy if i == 0 else uid_buy2
        lines.append(f"INSERT INTO listings (id, user_id, product_id, side, price, quantity, filled, status, delivery_period, delivery_location, margin_rate, allow_partial, min_quantity, created_at, updated_at)")
        lines.append(f"VALUES ('{lid}', '{uid}', '{pid}', 'BUY', {price}, {qty}, 0, 'OPEN', '{period}', '{loc}', 0.10, true, 10, now(), now());")
        prod_listings.append((lid, 'BUY', price, qty, uid))

    listing_ids[pid] = prod_listings

# === 生成今日逐笔成交（固定大量） ===
today = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
trade_idx = 0

# 为每个品种生成 8-12 笔成交，分布在 9:00-15:00
for pid, pname, base in PRODUCTS:
    n_trades = random.randint(8, 12)

    for _ in range(n_trades):
        h = random.randint(9, 15)
        m = random.randint(0, 59)
        s = random.randint(0, 59)
        ts = today.replace(hour=h, minute=m, second=s)

        trade_price = base + random.randint(-40, 40)
        trade_qty = random.choice([20, 50, 100, 150, 200])

        sellers = [(lid, s, p, q, uid) for lid, s, p, q, uid in listing_ids[pid] if s == 'SELL']
        buyers = [(lid, s, p, q, uid) for lid, s, p, q, uid in listing_ids[pid] if s == 'BUY']

        sell_entry = random.choice(sellers)
        buy_entry = random.choice(buyers)

        tid = f"10000000-0000-0000-0000-{trade_idx:012d}"
        tss = ts.strftime("%Y-%m-%d %H:%M:%S+08")
        loc = random.choice(LOCATIONS)
        period = random.choice(["现货", "7月下"])

        lines.append(f"INSERT INTO trades (id, product_id, buy_order_id, sell_order_id, buy_user_id, sell_user_id, price, quantity, traded_at, delivery_period, delivery_location)")
        lines.append(f"VALUES ('{tid}', '{pid}', '{buy_entry[0]}', '{sell_entry[0]}', '{buy_entry[4]}', '{sell_entry[4]}', {trade_price}, {trade_qty}, '{tss}', '{period}', '{loc}');")

        # 更新挂牌 filled
        lines.append(f"UPDATE listings SET filled = filled + {trade_qty // 2}, status = CASE WHEN filled + {trade_qty // 2} >= quantity THEN 'FILLED' ELSE 'PARTIAL' END, updated_at = now() WHERE id = '{buy_entry[0]}';")
        lines.append(f"UPDATE listings SET filled = filled + {trade_qty // 2}, status = CASE WHEN filled + {trade_qty // 2} >= quantity THEN 'FILLED' ELSE 'PARTIAL' END, updated_at = now() WHERE id = '{sell_entry[0]}';")

        trade_idx += 1

lines.append("COMMIT;")
lines.append("")
lines.append("-- 验证")
lines.append("SELECT 'active_listings' AS label, COUNT(*) FROM listings WHERE status IN ('OPEN', 'PARTIAL');")
lines.append("SELECT 'today_trades' AS label, COUNT(*) FROM trades WHERE traded_at::date = CURRENT_DATE;")
lines.append("SELECT 'latest_trade' AS label, MAX(traded_at) FROM trades WHERE traded_at::date = CURRENT_DATE;")

sql = "\n".join(lines)
with open("scripts/gen_mock_data.sql", "w") as f:
    f.write(sql)

n_listings = len([l for l in sql.split('\n') if l.startswith('INSERT INTO listings')])
n_trades = len([l for l in sql.split('\n') if l.startswith('INSERT INTO trades')])
print(f"Listings: {n_listings}, Trades: {n_trades}")
print("SQL written to scripts/gen_mock_data.sql")
