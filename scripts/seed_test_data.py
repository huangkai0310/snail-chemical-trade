"""
Snail Chemical Trade - 批量测试数据生成器 (v2)
==============================================
完整覆盖：
  - 测试用户（6个）
  - 资金账户 + 充值流水
  - 历史成交（K线数据，过去3天每5分钟1-2笔）
  - 当前活跃普通挂牌（各品种买/卖各5-8档）
  - 部分成交挂牌（展示进度条）
  - 换盘挂牌（包含 allow_partial、换品/换期各类）
  - 换盘还盘进度（部分已还盘）

使用方法：
  python scripts/seed_test_data.py
"""

import paramiko
import uuid
import random
import datetime
import io
import os

HOST = "115.159.64.125"
SSH_USER = "root"
SSH_PASSWORD = "Kai&19920310"
DB_USER = "snailtrade"
DB_PASS = "snailtrade2024"
DB_NAME = "snailtrade"

# ======================== 配置 ========================
PRODUCTS = [
    {"id": "benzene",     "name": "纯苯",         "base_price": 7200,  "volatility": 0.03},
    {"id": "propylene",   "name": "丙烯",         "base_price": 6800,  "volatility": 0.04},
    {"id": "phenol",      "name": "苯酚",         "base_price": 8500,  "volatility": 0.025},
    {"id": "acetone",     "name": "丙酮",         "base_price": 5800,  "volatility": 0.035},
    {"id": "isopropanol", "name": "异丙醇",       "base_price": 7500,  "volatility": 0.03},
    {"id": "mibk",        "name": "甲基异丁基酮", "base_price": 11000, "volatility": 0.028},
]

TEST_USERS = [
    {"username": "trader_zhang", "company_name": "华东化工贸易有限公司"},
    {"username": "trader_li",    "company_name": "南方石化集团"},
    {"username": "trader_wang",  "company_name": "北方化工原料有限公司"},
    {"username": "trader_chen",  "company_name": "中化国际贸易公司"},
    {"username": "trader_zhao",  "company_name": "浙江化工进出口公司"},
]

DELIVERY_LOCATIONS = [
    "华东仓库-上海", "华东仓库-宁波", "华南仓库-广州",
    "华北仓库-天津", "华中仓库-武汉", "西南仓库-成都",
]

# 当前时间 2026-06-29，有效交割期
DELIVERY_PERIODS = [
    "2606下", "2607上", "2607下", "2608上", "2608下",
    "2609上", "2609下", "2610上", "2610下", "2611上",
]

# 正确的 bcrypt hash，对应密码 test123456
# 已在服务器数据库中验证可用（$2b$ 格式）
PASSWORD_HASH = "$2b$10$Sxciy3W2XePSURs850uOvewjCPExQf.m0SdmLrFeXjaofKxfWbvca"

# 时间锚点（当前时间）
NOW = datetime.datetime(2026, 6, 29, 2, 30, 0, tzinfo=datetime.timezone.utc)
HISTORY_DAYS = 3   # 生成过去3天的K线
CANDLE_INTERVAL = 5  # 5分钟间隔

# ======================== 工具函数 ========================
def q(s):
    """SQL 字符串安全转义"""
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def rand_price(base, vol, factor=1.0):
    delta = base * vol * factor
    p = random.uniform(base - delta, base + delta)
    return round(round(p / 5) * 5, 2)  # 取整到5元


def gen_candle(prev_close, vol):
    change = random.gauss(0, prev_close * vol * 0.3)
    close_p = round((prev_close + change) / 5) * 5
    close_p = max(close_p, prev_close * 0.85)  # 防止异常低
    high_p = round((max(prev_close, close_p) + random.uniform(0, abs(change) * 0.5)) / 5) * 5
    low_p  = round((min(prev_close, close_p) - random.uniform(0, abs(change) * 0.5)) / 5) * 5
    low_p  = max(low_p, close_p * 0.95)  # 防止 low > close
    qty    = random.randint(5, 120)
    return prev_close, high_p, low_p, close_p, qty


# ======================== SQL 生成 ========================
def generate_sql(user_ids_fixed=None):
    """
    生成完整清空+重建的 SQL 脚本。
    user_ids_fixed: {username: uuid_str}，若提供则使用固定 UUID（确保密码hash一致）
    """
    lines = []
    lines.append("-- Snail Chemical Trade - 测试数据 v2")
    lines.append(f"-- 生成时间: {NOW.isoformat()}")
    lines.append("")
    lines.append("BEGIN;")
    lines.append("")

    # ====================================================
    # STEP 0: 清空旧数据（依赖顺序：先清子表再父表）
    # 注意：彻底清空 users 表（包含 admin），确保 UUID 一致
    # ====================================================
    lines.append("-- ===== STEP 0: 清空旧数据 =====")
    lines.append("TRUNCATE TABLE engine_wal              RESTART IDENTITY CASCADE;")
    lines.append("TRUNCATE TABLE swap_matches             RESTART IDENTITY CASCADE;")
    lines.append("TRUNCATE TABLE swap_listings            RESTART IDENTITY CASCADE;")
    lines.append("TRUNCATE TABLE margin_holds             RESTART IDENTITY CASCADE;")
    lines.append("TRUNCATE TABLE trades                   RESTART IDENTITY CASCADE;")
    lines.append("TRUNCATE TABLE listings                 RESTART IDENTITY CASCADE;")
    lines.append("TRUNCATE TABLE transactions             RESTART IDENTITY CASCADE;")
    lines.append("TRUNCATE TABLE accounts                 RESTART IDENTITY CASCADE;")
    lines.append("DELETE FROM users;  -- 彻底清空，包括 admin，确保 UUID 与后续 INSERT 一致")
    lines.append("")

    # ====================================================
    # STEP 1: 测试用户（纯 INSERT，不用 ON CONFLICT）
    # ====================================================
    lines.append("-- ===== STEP 1: 测试用户 =====")
    user_ids = {}  # username -> uuid_str

    # admin 用户（直接 INSERT，UUID 由本脚本控制）
    admin_uid = (user_ids_fixed or {}).get("admin") or str(uuid.uuid4())
    user_ids["admin"] = admin_uid
    lines.append(f"INSERT INTO users (id, username, password_hash, role, status) "
                 f"VALUES ('{admin_uid}', 'admin', {q(PASSWORD_HASH)}, 'admin', 'active');")

    for u in TEST_USERS:
        uid = (user_ids_fixed or {}).get(u["username"]) or str(uuid.uuid4())
        user_ids[u["username"]] = uid
        lines.append(
            f"INSERT INTO users (id, username, password_hash, company_name, role, status) "
            f"VALUES ('{uid}', {q(u['username'])}, {q(PASSWORD_HASH)}, "
            f"{q(u['company_name'])}, 'user', 'active');"
        )
    lines.append("")

    uid_list = list(user_ids.values())
    trader_uids = [user_ids[u["username"]] for u in TEST_USERS]  # 不含 admin

    # ====================================================
    # STEP 2: 资金账户 + 充值流水
    # ====================================================
    lines.append("-- ===== STEP 2: 资金账户 + 充值流水 =====")
    account_ids = {}
    balances = {}
    for username, uid in user_ids.items():
        aid = str(uuid.uuid4())
        account_ids[uid] = aid
        # admin 给少一点
        amount = random.randint(300000, 500000) if username == "admin" else random.randint(800000, 3000000)
        balances[uid] = amount
        lines.append(
            f"INSERT INTO accounts (id, user_id, balance, frozen, total_in) "
            f"VALUES ('{aid}', '{uid}', {amount}, 0, {amount});"
        )
        tid = str(uuid.uuid4())
        lines.append(
            f"INSERT INTO transactions (id, user_id, account_id, type, amount, "
            f"balance_before, balance_after, frozen_before, frozen_after, remark) "
            f"VALUES ('{tid}', '{uid}', '{aid}', 'DEPOSIT', {amount}, 0, {amount}, 0, 0, '初始充值');"
        )
    lines.append("")

    # ====================================================
    # STEP 3: 历史成交 + K线数据
    # ====================================================
    lines.append("-- ===== STEP 3: 历史成交 + K线数据 =====")
    total_candles = HISTORY_DAYS * 24 * (60 // CANDLE_INTERVAL)  # 3天 * 24h * 12 = 864根

    total_trade_count = 0
    product_last_price = {}  # 记录每个品种最新价，供后续活跃挂牌用

    for product in PRODUCTS:
        pid = product["id"]
        base = product["base_price"]
        vol = product["volatility"]
        prev_close = base

        listing_batch = []
        trade_batch = []
        lines.append(f"-- 产品: {product['name']} ({pid})")

        for idx in range(total_candles):
            candle_time = NOW - datetime.timedelta(
                minutes=(total_candles - idx) * CANDLE_INTERVAL
            )
            open_p, high_p, low_p, close_p, _ = gen_candle(prev_close, vol)

            # 每根K线 1-3 笔成交
            num_trades = random.choices([1, 2, 3], weights=[50, 35, 15])[0]

            for _ in range(num_trades):
                # 随机买卖双方（不同用户）
                buyer_uid = random.choice(trader_uids)
                seller_uid = random.choice(trader_uids)
                while seller_uid == buyer_uid and len(trader_uids) > 1:
                    seller_uid = random.choice(trader_uids)

                trade_price = round(round(random.uniform(low_p, high_p) / 5) * 5, 2)
                trade_qty   = random.randint(5, 80)
                trade_time  = candle_time + datetime.timedelta(seconds=random.randint(0, CANDLE_INTERVAL * 60 - 1))

                buy_lid  = str(uuid.uuid4())
                sell_lid = str(uuid.uuid4())
                dp = random.choice(DELIVERY_PERIODS)
                dl = random.choice(DELIVERY_LOCATIONS)
                dp2 = random.choice(DELIVERY_PERIODS)
                dl2 = random.choice(DELIVERY_LOCATIONS)

                buy_ts  = trade_time - datetime.timedelta(seconds=random.randint(10, 120))
                sell_ts = trade_time - datetime.timedelta(seconds=random.randint(10, 120))

                listing_batch.append(
                    f"('{buy_lid}', '{buyer_uid}', '{pid}', 'BUY', {trade_price}, "
                    f"{trade_qty}, {trade_qty}, 'CLOSED', {q(dp)}, {q(dl)}, true, "
                    f"'{buy_ts.strftime('%Y-%m-%dT%H:%M:%S+00:00')}', '{buy_ts.strftime('%Y-%m-%dT%H:%M:%S+00:00')}')"
                )
                listing_batch.append(
                    f"('{sell_lid}', '{seller_uid}', '{pid}', 'SELL', {trade_price}, "
                    f"{trade_qty}, {trade_qty}, 'CLOSED', {q(dp2)}, {q(dl2)}, true, "
                    f"'{sell_ts.strftime('%Y-%m-%dT%H:%M:%S+00:00')}', '{sell_ts.strftime('%Y-%m-%dT%H:%M:%S+00:00')}')"
                )
                trade_batch.append(
                    f"('{str(uuid.uuid4())}', '{pid}', '{buy_lid}', '{sell_lid}', "
                    f"'{buyer_uid}', '{seller_uid}', {trade_price}, {trade_qty}, "
                    f"{q(dp)}, {q(dl)}, '{trade_time.strftime('%Y-%m-%dT%H:%M:%S+00:00')}')"
                )
                total_trade_count += 1

            prev_close = close_p

        product_last_price[pid] = prev_close

        # 批量写入 listings（500条一批）
        CHUNK = 500
        for i in range(0, len(listing_batch), CHUNK):
            chunk = listing_batch[i:i+CHUNK]
            lines.append(
                "INSERT INTO listings (id, user_id, product_id, side, price, quantity, "
                "filled, status, delivery_period, delivery_location, allow_partial, created_at, updated_at) VALUES"
            )
            lines.append(",\n".join(chunk) + ";")

        for i in range(0, len(trade_batch), CHUNK):
            chunk = trade_batch[i:i+CHUNK]
            lines.append(
                "INSERT INTO trades (id, product_id, buy_order_id, sell_order_id, "
                "buy_user_id, sell_user_id, price, quantity, delivery_period, delivery_location, traded_at) VALUES"
            )
            lines.append(",\n".join(chunk) + ";")

        lines.append("")

    print(f"  生成 {total_trade_count} 笔历史成交")

    # ====================================================
    # STEP 4: 当前活跃普通挂牌（买卖盘口）
    # ====================================================
    lines.append("-- ===== STEP 4: 当前活跃普通挂牌 =====")
    active_count = 0
    active_batch = []

    for product in PRODUCTS:
        pid = product["id"]
        mid = product_last_price.get(pid, product["base_price"])
        vol = product["volatility"]

        num_buy  = random.randint(6, 10)
        num_sell = random.randint(6, 10)

        for i in range(num_buy):
            spread = random.uniform(0.003, 0.04) * (i + 1)
            p   = round(round(mid * (1 - spread) / 5) * 5, 2)
            qty = random.randint(20, 300)
            uid = random.choice(trader_uids)
            dp  = random.choice(DELIVERY_PERIODS)
            dl  = random.choice(DELIVERY_LOCATIONS)
            lid = str(uuid.uuid4())
            allow_partial = random.choices([True, False], weights=[75, 25])[0]
            ts  = NOW - datetime.timedelta(minutes=random.randint(1, 120))
            active_batch.append(
                f"('{lid}', '{uid}', '{pid}', 'BUY', {p}, {qty}, "
                f"0, 'OPEN', {q(dp)}, {q(dl)}, {'true' if allow_partial else 'false'}, "
                f"'{ts.strftime('%Y-%m-%dT%H:%M:%S+00:00')}', '{ts.strftime('%Y-%m-%dT%H:%M:%S+00:00')}')"
            )
            active_count += 1

        for i in range(num_sell):
            spread = random.uniform(0.003, 0.04) * (i + 1)
            p   = round(round(mid * (1 + spread) / 5) * 5, 2)
            qty = random.randint(20, 300)
            uid = random.choice(trader_uids)
            dp  = random.choice(DELIVERY_PERIODS)
            dl  = random.choice(DELIVERY_LOCATIONS)
            lid = str(uuid.uuid4())
            allow_partial = random.choices([True, False], weights=[75, 25])[0]
            ts  = NOW - datetime.timedelta(minutes=random.randint(1, 120))
            active_batch.append(
                f"('{lid}', '{uid}', '{pid}', 'SELL', {p}, {qty}, "
                f"0, 'OPEN', {q(dp)}, {q(dl)}, {'true' if allow_partial else 'false'}, "
                f"'{ts.strftime('%Y-%m-%dT%H:%M:%S+00:00')}', '{ts.strftime('%Y-%m-%dT%H:%M:%S+00:00')}')"
            )
            active_count += 1

    CHUNK = 500
    for i in range(0, len(active_batch), CHUNK):
        chunk = active_batch[i:i+CHUNK]
        lines.append(
            "INSERT INTO listings (id, user_id, product_id, side, price, quantity, "
            "filled, status, delivery_period, delivery_location, allow_partial, created_at, updated_at) VALUES"
        )
        lines.append(",\n".join(chunk) + ";")
    lines.append("")
    print(f"  生成 {active_count} 个活跃挂牌")

    # ====================================================
    # STEP 5: 部分成交挂牌（展示 FillBar 进度条）
    # ====================================================
    lines.append("-- ===== STEP 5: 部分成交挂牌 =====")
    partial_batch = []
    partial_count = 0
    for product in PRODUCTS:
        pid = product["id"]
        mid = product_last_price.get(pid, product["base_price"])

        for _ in range(random.randint(2, 5)):
            p      = rand_price(mid, product["volatility"], 0.5)
            qty    = random.randint(80, 500)
            filled = random.randint(int(qty * 0.15), int(qty * 0.75))
            uid    = random.choice(trader_uids)
            side   = random.choice(["BUY", "SELL"])
            dp     = random.choice(DELIVERY_PERIODS)
            dl     = random.choice(DELIVERY_LOCATIONS)
            lid    = str(uuid.uuid4())
            ts     = NOW - datetime.timedelta(minutes=random.randint(10, 240))
            partial_batch.append(
                f"('{lid}', '{uid}', '{pid}', '{side}', {p}, {qty}, "
                f"{filled}, 'PARTIAL', {q(dp)}, {q(dl)}, true, "
                f"'{ts.strftime('%Y-%m-%dT%H:%M:%S+00:00')}', '{ts.strftime('%Y-%m-%dT%H:%M:%S+00:00')}')"
            )
            partial_count += 1

    for i in range(0, len(partial_batch), CHUNK):
        chunk = partial_batch[i:i+CHUNK]
        lines.append(
            "INSERT INTO listings (id, user_id, product_id, side, price, quantity, "
            "filled, status, delivery_period, delivery_location, allow_partial, created_at, updated_at) VALUES"
        )
        lines.append(",\n".join(chunk) + ";")
    lines.append("")
    print(f"  生成 {partial_count} 个部分成交挂牌")

    # ====================================================
    # STEP 6: 换盘挂牌（核心新增）
    # ====================================================
    lines.append("-- ===== STEP 6: 换盘挂牌 =====")
    swap_batch = []
    swap_count = 0

    # 换盘场景设计（12种不同组合）
    swap_scenarios = [
        # 换期（同品种不同交割期）
        {"sell_pid": "benzene",     "buy_pid": "benzene",     "label": "苯换期",      "allow_partial": True},
        {"sell_pid": "propylene",   "buy_pid": "propylene",   "label": "丙烯换期",    "allow_partial": True},
        {"sell_pid": "phenol",      "buy_pid": "phenol",      "label": "苯酚换期",    "allow_partial": False},
        {"sell_pid": "acetone",     "buy_pid": "acetone",     "label": "丙酮换期",    "allow_partial": True},
        {"sell_pid": "isopropanol", "buy_pid": "isopropanol", "label": "异丙醇换期",  "allow_partial": False},
        # 换品（跨品种）
        {"sell_pid": "benzene",     "buy_pid": "propylene",   "label": "苯换丙烯",    "allow_partial": True},
        {"sell_pid": "propylene",   "buy_pid": "phenol",      "label": "丙烯换苯酚",  "allow_partial": True},
        {"sell_pid": "phenol",      "buy_pid": "acetone",     "label": "苯酚换丙酮",  "allow_partial": False},
        {"sell_pid": "acetone",     "buy_pid": "benzene",     "label": "丙酮换苯",    "allow_partial": True},
        {"sell_pid": "mibk",        "buy_pid": "isopropanol", "label": "MIBK换异丙醇","allow_partial": True},
        {"sell_pid": "isopropanol", "buy_pid": "benzene",     "label": "异丙醇换苯",  "allow_partial": False},
        {"sell_pid": "benzene",     "buy_pid": "mibk",        "label": "苯换MIBK",    "allow_partial": True},
    ]

    for i, sc in enumerate(swap_scenarios):
        sell_pid = sc["sell_pid"]
        buy_pid  = sc["buy_pid"]
        allow_partial = sc["allow_partial"]

        sell_mid = product_last_price.get(sell_pid, next(p["base_price"] for p in PRODUCTS if p["id"] == sell_pid))
        buy_mid  = product_last_price.get(buy_pid,  next(p["base_price"] for p in PRODUCTS if p["id"] == buy_pid))

        sell_price = rand_price(sell_mid, 0.02, 0.5)
        buy_price  = rand_price(buy_mid,  0.02, 0.5)
        sell_qty   = random.randint(50, 300)
        buy_qty    = random.randint(50, 300) if sell_pid != buy_pid else sell_qty  # 换期时买卖数量一致

        # 部分已还盘（约半数场景有进度）
        if allow_partial and random.random() < 0.6:
            sell_filled = random.randint(int(sell_qty * 0.1), int(sell_qty * 0.7))
            buy_filled  = sell_filled  # 简化：卖买进度同步
            status = "OPEN"
        else:
            sell_filled = 0.0
            buy_filled  = 0.0
            status = "OPEN"

        sell_dp = random.choice(DELIVERY_PERIODS)
        # 换期时买腿选择不同的交割期
        if sell_pid == buy_pid:
            remaining = [dp for dp in DELIVERY_PERIODS if dp != sell_dp]
            buy_dp = random.choice(remaining) if remaining else random.choice(DELIVERY_PERIODS)
        else:
            buy_dp = random.choice(DELIVERY_PERIODS)

        sell_dl = random.choice(DELIVERY_LOCATIONS)
        buy_dl  = random.choice(DELIVERY_LOCATIONS)

        uid = random.choice(trader_uids)
        sid = str(uuid.uuid4())
        ts  = NOW - datetime.timedelta(minutes=random.randint(5, 480))
        remark = sc["label"]

        swap_batch.append(
            f"('{sid}', '{uid}', '{sell_pid}', '{status}', "
            f"'{sell_pid}', {sell_price}, {sell_qty}, {sell_filled}, {q(sell_dp)}, {q(sell_dl)}, "
            f"'{buy_pid}',  {buy_price},  {buy_qty},  {buy_filled},  {q(buy_dp)},  {q(buy_dl)}, "
            f"{q(remark)}, {'true' if allow_partial else 'false'}, "
            f"'{ts.strftime('%Y-%m-%dT%H:%M:%S+00:00')}', '{ts.strftime('%Y-%m-%dT%H:%M:%S+00:00')}')"
        )
        swap_count += 1

    # 再额外生成 8 个随机换盘
    for _ in range(8):
        sell_prod = random.choice(PRODUCTS)
        buy_prod  = random.choice(PRODUCTS)
        sell_pid  = sell_prod["id"]
        buy_pid   = buy_prod["id"]
        allow_partial = random.choices([True, False], weights=[70, 30])[0]

        sell_mid = product_last_price.get(sell_pid, sell_prod["base_price"])
        buy_mid  = product_last_price.get(buy_pid,  buy_prod["base_price"])

        sell_price = rand_price(sell_mid, 0.025, 0.8)
        buy_price  = rand_price(buy_mid,  0.025, 0.8)
        sell_qty   = random.randint(30, 400)
        buy_qty    = sell_qty if sell_pid == buy_pid else random.randint(30, 400)

        if allow_partial and random.random() < 0.5:
            sell_filled = random.randint(int(sell_qty * 0.05), int(sell_qty * 0.5))
            buy_filled  = sell_filled
        else:
            sell_filled = buy_filled = 0.0

        sell_dp = random.choice(DELIVERY_PERIODS)
        buy_dp  = random.choice(DELIVERY_PERIODS)
        sell_dl = random.choice(DELIVERY_LOCATIONS)
        buy_dl  = random.choice(DELIVERY_LOCATIONS)

        uid = random.choice(trader_uids)
        sid = str(uuid.uuid4())
        ts  = NOW - datetime.timedelta(minutes=random.randint(1, 720))
        remark_val = None

        swap_batch.append(
            f"('{sid}', '{uid}', '{sell_pid}', 'OPEN', "
            f"'{sell_pid}', {sell_price}, {sell_qty}, {sell_filled}, {q(sell_dp)}, {q(sell_dl)}, "
            f"'{buy_pid}',  {buy_price},  {buy_qty},  {buy_filled},  {q(buy_dp)},  {q(buy_dl)}, "
            f"{q(remark_val)}, {'true' if allow_partial else 'false'}, "
            f"'{ts.strftime('%Y-%m-%dT%H:%M:%S+00:00')}', '{ts.strftime('%Y-%m-%dT%H:%M:%S+00:00')}')"
        )
        swap_count += 1

    if swap_batch:
        lines.append(
            "INSERT INTO swap_listings ("
            "id, user_id, product_id, status, "
            "sell_product_id, sell_price, sell_quantity, sell_filled, sell_delivery_period, sell_delivery_location, "
            "buy_product_id,  buy_price,  buy_quantity,  buy_filled,  buy_delivery_period,  buy_delivery_location, "
            "remark, allow_partial, created_at, updated_at"
            ") VALUES"
        )
        lines.append(",\n".join(swap_batch) + ";")
    lines.append("")
    print(f"  生成 {swap_count} 个换盘挂牌")

    # ====================================================
    # STEP 7: COMMIT + 统计
    # ====================================================
    lines.append("COMMIT;")
    lines.append("")
    lines.append("-- ===== 数据统计 =====")
    for tbl in ["users", "accounts", "transactions", "listings", "trades", "swap_listings", "swap_matches", "margin_holds"]:
        lines.append(f"SELECT '{tbl}' AS \"表\", COUNT(*) AS \"行数\" FROM {tbl};")
    lines.append("SELECT product_id, COUNT(*) AS trade_count, ROUND(AVG(price),2) AS avg_price FROM trades GROUP BY product_id ORDER BY product_id;")

    return "\n".join(lines)


# ======================== 部署执行 ========================
def run_ssh(ssh, cmd, timeout=300):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if err and "NOTICE" not in err and "WARNING" not in err:
        print(f"  [stderr] {err[:300]}")
    return out


def main():
    print("=" * 60)
    print("Snail Chemical Trade - 测试数据生成器 v2")
    print("=" * 60)
    print(f"目标服务器: {HOST}")
    print(f"历史数据天数: {HISTORY_DAYS} 天")
    print(f"K线间隔: {CANDLE_INTERVAL} 分钟")
    print(f"产品数: {len(PRODUCTS)}")
    print(f"测试用户数: {len(TEST_USERS) + 1} (含 admin)")
    print()

    # ---- Step 1: 先查出当前用户 UUID（保持密码hash一致性）----
    print("[0/4] 连接服务器，查询现有用户...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=SSH_USER, password=SSH_PASSWORD, timeout=30)

    user_query = (
        f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} -t -A -F'|' "
        f"-c \"SELECT username, id FROM users WHERE username IN "
        f"('admin','trader_zhang','trader_li','trader_wang','trader_chen','trader_zhao');\""
    )
    result = run_ssh(ssh, user_query, timeout=15)
    user_ids_fixed = {}
    for line in result.strip().split("\n"):
        line = line.strip()
        if "|" in line:
            parts = line.split("|")
            if len(parts) >= 2:
                username, uid = parts[0].strip(), parts[1].strip()
                user_ids_fixed[username] = uid
    print(f"  已有用户: {list(user_ids_fixed.keys())}")

    # ---- Step 2: 本地生成 SQL ----
    print("[1/4] 本地生成 SQL 文件...")
    sql_content = generate_sql(user_ids_fixed)
    sql_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_test_data.sql")
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write(sql_content)
    sql_size = os.path.getsize(sql_path) / 1024 / 1024
    print(f"  SQL 文件: {sql_path} ({sql_size:.2f} MB)")

    # ---- Step 3: 上传并执行 ----
    print("[2/4] 上传 SQL 到服务器...")
    sftp = ssh.open_sftp()
    remote_sql = "/tmp/seed_test_data_v2.sql"
    sftp.put(sql_path, remote_sql)
    sftp.close()
    print(f"  已上传 {remote_sql}")

    print("[3/4] 执行 SQL（可能需要 1-3 分钟）...")
    exec_cmd = (
        f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} "
        f"-f {remote_sql} 2>&1"
    )
    result = run_ssh(ssh, exec_cmd, timeout=600)

    # 只打印最后 40 行（含统计结果）
    lines_out = [l for l in result.split("\n") if l.strip()]
    for line in lines_out[-40:]:
        stripped = line.strip()
        if stripped and "INSERT" not in stripped:
            print(f"  {stripped}")

    # ---- Step 4: 验证 ----
    print("[4/4] 验证数据量...")
    tables = [
        "users", "accounts", "transactions",
        "listings", "trades",
        "swap_listings", "swap_matches",
        "margin_holds",
    ]
    for tbl in tables:
        cnt = run_ssh(
            ssh,
            f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} -t -c \"SELECT COUNT(*) FROM {tbl}\" 2>&1",
            timeout=15,
        )
        print(f"  {tbl:20s}: {cnt.strip():>8} 行")

    # 按产品统计成交
    print("\n  按产品成交分布:")
    stats = run_ssh(
        ssh,
        f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} "
        f"-t -A -F'|' -c "
        f"\"SELECT product_id, COUNT(*), ROUND(MIN(price),0), ROUND(MAX(price),0), ROUND(AVG(price),0) "
        f"FROM trades GROUP BY product_id ORDER BY product_id;\" 2>&1",
        timeout=15,
    )
    for line in stats.strip().split("\n"):
        if "|" in line:
            parts = line.split("|")
            if len(parts) >= 5:
                print(f"    {parts[0]:<14}: {parts[1]:>6} 笔  价格范围 {parts[2]}~{parts[3]} 均价 {parts[4]}")

    # 换盘统计
    print("\n  换盘挂牌分布:")
    swap_stats = run_ssh(
        ssh,
        f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} "
        f"-t -A -F'|' -c "
        f"\"SELECT sell_product_id, buy_product_id, allow_partial, "
        f"sell_filled > 0 AS has_progress "
        f"FROM swap_listings ORDER BY created_at DESC;\" 2>&1",
        timeout=15,
    )
    for line in swap_stats.strip().split("\n"):
        if "|" in line:
            parts = line.split("|")
            if len(parts) >= 4:
                ap = "可拆" if parts[2].strip() == "t" else "不可拆"
                prog = "有进度" if parts[3].strip() == "t" else "未还盘"
                print(f"    {parts[0]:<14} → {parts[1]:<14} [{ap}] [{prog}]")

    # 重启后端让引擎重载订单簿
    print("\n  重启后端服务（重载订单簿）...")
    run_ssh(ssh, "systemctl restart snail-api", timeout=30)
    import time
    time.sleep(3)
    health = run_ssh(ssh, "curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/health 2>/dev/null || echo '待启动'", timeout=15)
    print(f"  后端健康检查: {health}")

    # 清理临时文件
    run_ssh(ssh, f"rm -f {remote_sql}", timeout=10)
    ssh.close()

    print()
    print("✅ 测试数据生成完成！")
    print(f"   访问: https://trade.snailchemical.com")
    print(f"   测试账户密码: test123456")
    print(f"   用户列表: admin, {', '.join(u['username'] for u in TEST_USERS)}")


if __name__ == "__main__":
    random.seed(2026)  # 固定种子，确保可重现
    main()