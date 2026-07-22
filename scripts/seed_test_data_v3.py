"""
Snail Chemical Trade - 批量测试数据生成器 (v3)
==============================================
完整覆盖所有面板：
  - 测试用户（6个）+ 资金账户 + 多样化流水（DEPOSIT/FREEZE/TRADE_DEDUCT/TRADE_INCOME/UNFREEZE）
  - 历史成交（K线数据，过去3天每5分钟1-2笔）→ FILLED 状态
  - 当前活跃普通挂牌（买/卖 OPEN 各6-10档）+ min_quantity
  - 部分成交挂牌（PARTIAL 状态，展示进度条）
  - 已成交挂牌（FILLED 状态，"我的"页面需要）
  - 已撤盘挂牌（CANCELLED 状态，"我的"页面需要）
  - 已过期挂牌（EXPIRED 状态，"我的"页面需要）
  - 换盘挂牌（换期/换品，含独立双腿拆单字段 + min_quantity）
  - 换盘匹配记录（swap_matches）
  - 保证金冻结记录（margin_holds）—— 覆盖所有挂牌状态
  - 站内消息（conversations + messages）

使用方法：
  python scripts/seed_test_data_v3.py
"""

import paramiko
import uuid
import random
import datetime
import os
import time as time_module

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

DELIVERY_PERIODS = [
    "现货",
    "2606下", "2607上", "2607下", "2608上", "2608下",
    "2609上", "2609下", "2610上", "2610下", "2611上",
]

PASSWORD_HASH = "$2b$10$Sxciy3W2XePSURs850uOvewjCPExQf.m0SdmLrFeXjaofKxfWbvca"
SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001"

# 使用当前时间作为基准（确保活跃挂牌的 created_at 为今天，避免被过期清理任务立即标记为 EXPIRED）
NOW = datetime.datetime.now(datetime.timezone.utc)
HISTORY_DAYS = 3
CANDLE_INTERVAL = 5
MARGIN_RATE = 0.10

# ======================== 工具函数 ========================
def q(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def rand_price(base, vol, factor=1.0):
    delta = base * vol * factor
    p = random.uniform(base - delta, base + delta)
    return round(round(p / 5) * 5, 2)


def gen_candle(prev_close, vol):
    change = random.gauss(0, prev_close * vol * 0.3)
    close_p = round((prev_close + change) / 5) * 5
    close_p = max(close_p, prev_close * 0.85)
    high_p = round((max(prev_close, close_p) + random.uniform(0, abs(change) * 0.5)) / 5) * 5
    low_p  = round((min(prev_close, close_p) - random.uniform(0, abs(change) * 0.5)) / 5) * 5
    low_p  = max(low_p, close_p * 0.95)
    qty    = random.randint(5, 120)
    return prev_close, high_p, low_p, close_p, qty


def fmt_time(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%S+00:00')


# ======================== SQL 生成 ========================
def generate_sql(user_ids_fixed=None):
    lines = []
    lines.append("-- Snail Chemical Trade - 测试数据 v3（全面板覆盖）")
    lines.append(f"-- 生成时间: {NOW.isoformat()}")
    lines.append("")
    lines.append("BEGIN;")
    lines.append("")

    CHUNK = 500

    def batch_insert(header, rows):
        for i in range(0, len(rows), CHUNK):
            chunk = rows[i:i+CHUNK]
            lines.append(header)
            lines.append(",\n".join(chunk) + ";")

    # ===== STEP 0: 清空 =====
    lines.append("-- ===== STEP 0: 清空 =====")
    tables = ["messages", "conversations", "engine_wal", "swap_matches",
              "swap_listings", "margin_holds", "trades", "listings",
              "transactions", "accounts"]
    for t in tables:
        lines.append(f"TRUNCATE TABLE {t} RESTART IDENTITY CASCADE;")
    lines.append("DELETE FROM users;")
    lines.append("")

    # ===== STEP 1: 用户 =====
    lines.append("-- ===== STEP 1: 用户 =====")
    user_ids = {}
    admin_uid = (user_ids_fixed or {}).get("admin") or str(uuid.uuid4())
    user_ids["admin"] = admin_uid
    lines.append(
        f"INSERT INTO users (id, username, password_hash, role, status) "
        f"VALUES ('{admin_uid}', 'admin', {q(PASSWORD_HASH)}, 'admin', 'active');")
    lines.append(
        f"INSERT INTO users (id, username, password_hash, role, status) "
        f"VALUES ('{SYSTEM_USER_ID}', 'system', {q(PASSWORD_HASH)}, 'system', 'active');")
    for u in TEST_USERS:
        uid = (user_ids_fixed or {}).get(u["username"]) or str(uuid.uuid4())
        user_ids[u["username"]] = uid
        lines.append(
            f"INSERT INTO users (id, username, password_hash, company_name, role, status) "
            f"VALUES ('{uid}', {q(u['username'])}, {q(PASSWORD_HASH)}, "
            f"{q(u['company_name'])}, 'user', 'active');")
    lines.append("")
    trader_uids = [user_ids[u["username"]] for u in TEST_USERS]

    # ===== STEP 2: 账户 + 充值 =====
    lines.append("-- ===== STEP 2: 账户 + 充值 =====")
    account_ids = {}
    balances = {}
    for username, uid in user_ids.items():
        aid = str(uuid.uuid4())
        account_ids[uid] = aid
        amt = random.randint(500000, 2000000) if username == "admin" else random.randint(1000000, 5000000)
        balances[uid] = amt
        lines.append(
            f"INSERT INTO accounts (id, user_id, balance, frozen, total_in, total_out) "
            f"VALUES ('{aid}', '{uid}', {amt}, 0, {amt}, 0);")
        tid = str(uuid.uuid4())
        dep_ts = NOW - datetime.timedelta(days=7)
        lines.append(
            f"INSERT INTO transactions (id, user_id, account_id, type, amount, "
            f"balance_before, balance_after, frozen_before, frozen_after, remark, created_at) "
            f"VALUES ('{tid}', '{uid}', '{aid}', 'DEPOSIT', {amt}, 0, {amt}, 0, 0, "
            f"'初始充值', '{fmt_time(dep_ts)}');")
    sys_aid = str(uuid.uuid4())
    account_ids[SYSTEM_USER_ID] = sys_aid
    lines.append(f"INSERT INTO accounts (id, user_id, balance, frozen, total_in, total_out) "
                 f"VALUES ('{sys_aid}', '{SYSTEM_USER_ID}', 0, 0, 0, 0);")
    lines.append("")

    # 累积数据
    all_listing_rows = []
    all_trade_rows = []
    all_margin_rows = []
    all_tx_rows = []

    LISTING_HEADER = (
        "INSERT INTO listings (id, user_id, product_id, side, price, quantity, "
        "filled, status, delivery_period, delivery_location, allow_partial, min_quantity, "
        "created_at, updated_at) VALUES"
    )
    TRADE_HEADER = (
        "INSERT INTO trades (id, product_id, buy_order_id, sell_order_id, "
        "buy_user_id, sell_user_id, price, quantity, delivery_period, delivery_location, traded_at) VALUES"
    )
    MARGIN_HEADER = (
        "INSERT INTO margin_holds (id, user_id, account_id, listing_id, product_id, side, "
        "price, quantity, margin_rate, hold_amount, released_amount, status, created_at, updated_at) VALUES"
    )
    TX_HEADER = (
        "INSERT INTO transactions (id, user_id, account_id, type, amount, "
        "balance_before, balance_after, frozen_before, frozen_after, remark, created_at) VALUES"
    )

    # ===== STEP 3: 历史成交 + K线（FILLED） =====
    lines.append("-- ===== STEP 3: 历史成交 + K线（FILLED） =====")
    total_candles = HISTORY_DAYS * 24 * (60 // CANDLE_INTERVAL)
    total_trade_count = 0
    product_last_price = {}

    for product in PRODUCTS:
        pid = product["id"]
        base = product["base_price"]
        vol = product["volatility"]
        prev_close = base

        for idx in range(total_candles):
            ct = NOW - datetime.timedelta(minutes=(total_candles - idx) * CANDLE_INTERVAL)
            _, high_p, low_p, close_p, _ = gen_candle(prev_close, vol)
            nt = random.choices([1, 2, 3], weights=[50, 35, 15])[0]

            for _ in range(nt):
                buid = random.choice(trader_uids)
                suid = random.choice(trader_uids)
                while suid == buid and len(trader_uids) > 1:
                    suid = random.choice(trader_uids)

                tp = round(round(random.uniform(low_p, high_p) / 5) * 5, 2)
                tq = random.randint(5, 80)
                tt = ct + datetime.timedelta(seconds=random.randint(0, CANDLE_INTERVAL * 60 - 1))

                blid = str(uuid.uuid4())
                slid = str(uuid.uuid4())
                dp  = random.choice(DELIVERY_PERIODS)
                dl  = random.choice(DELIVERY_LOCATIONS)
                dp2 = random.choice(DELIVERY_PERIODS)
                dl2 = random.choice(DELIVERY_LOCATIONS)
                bts = tt - datetime.timedelta(seconds=random.randint(10, 120))
                sts = tt - datetime.timedelta(seconds=random.randint(10, 120))

                # 挂牌（FILLED）
                all_listing_rows.append(
                    f"('{blid}', '{buid}', '{pid}', 'BUY', {tp}, {tq}, {tq}, 'FILLED', "
                    f"{q(dp)}, {q(dl)}, true, {tq}, '{fmt_time(bts)}', '{fmt_time(bts)}')")
                all_listing_rows.append(
                    f"('{slid}', '{suid}', '{pid}', 'SELL', {tp}, {tq}, {tq}, 'FILLED', "
                    f"{q(dp2)}, {q(dl2)}, true, {tq}, '{fmt_time(sts)}', '{fmt_time(sts)}')")
                # 成交
                all_trade_rows.append(
                    f"('{str(uuid.uuid4())}', '{pid}', '{blid}', '{slid}', "
                    f"'{buid}', '{suid}', {tp}, {tq}, {q(dp)}, {q(dl)}, '{fmt_time(tt)}')")
                # 保证金
                bh = round(tp * tq * MARGIN_RATE, 2)
                sh = round(tp * tq * MARGIN_RATE, 2)
                all_margin_rows.append(
                    f"('{str(uuid.uuid4())}', '{buid}', '{account_ids[buid]}', "
                    f"'{blid}', '{pid}', 'BUY', {tp}, {tq}, {MARGIN_RATE}, {bh}, {bh}, 'RELEASED', "
                    f"'{fmt_time(bts)}', '{fmt_time(tt)}')")
                all_margin_rows.append(
                    f"('{str(uuid.uuid4())}', '{suid}', '{account_ids[suid]}', "
                    f"'{slid}', '{pid}', 'SELL', {tp}, {tq}, {MARGIN_RATE}, {sh}, {sh}, 'RELEASED', "
                    f"'{fmt_time(sts)}', '{fmt_time(tt)}')")
                # 流水
                for uid, hid in [(buid, bh), (suid, sh)]:
                    bal = balances[uid]
                    all_tx_rows.append(
                        f"('{str(uuid.uuid4())}', '{uid}', '{account_ids[uid]}', "
                        f"'FREEZE', {hid}, {bal}, {bal - hid}, 0, {hid}, '冻结保证金', '{fmt_time(bts)}')")
                    all_tx_rows.append(
                        f"('{str(uuid.uuid4())}', '{uid}', '{account_ids[uid]}', "
                        f"'TRADE_DEDUCT', {hid}, {bal - hid}, {bal - hid}, "
                        f"{hid}, 0, '成交扣保证金', '{fmt_time(tt)}')")
                    inc = round(tp * tq, 2)
                    all_tx_rows.append(
                        f"('{str(uuid.uuid4())}', '{uid}', '{account_ids[uid]}', "
                        f"'TRADE_INCOME', {inc}, {bal - hid}, {bal - hid + inc}, "
                        f"0, 0, '成交收入', '{fmt_time(tt)}')")
                    balances[uid] = bal - hid + inc
                total_trade_count += 1
            prev_close = close_p
        product_last_price[pid] = prev_close

    batch_insert(LISTING_HEADER, all_listing_rows)
    lines.append("")
    batch_insert(TRADE_HEADER, all_trade_rows)
    lines.append("")
    batch_insert(MARGIN_HEADER, all_margin_rows)
    lines.append("")
    batch_insert(TX_HEADER, all_tx_rows)
    lines.append("")
    print(f"  STEP3: {total_trade_count} 笔历史成交（FILLED）+ 保证金 + 流水")

    all_listing_rows.clear()
    all_trade_rows.clear()
    all_margin_rows.clear()
    all_tx_rows.clear()

    # ===== STEP 4: 活跃挂牌（OPEN）=====
    lines.append("-- ===== STEP 4: 活跃挂牌（OPEN） =====")
    active_count = 0
    for product in PRODUCTS:
        pid = product["id"]
        mid = product_last_price.get(pid, product["base_price"])
        for side_tag, sign in [("BUY", -1), ("SELL", 1)]:
            for _ in range(random.randint(6, 10)):
                spread = random.uniform(0.003, 0.04) * (random.randint(1, 5))
                p   = round(round(mid * (1 + sign * spread) / 5) * 5, 2)
                qty = random.randint(20, 300)
                uid = random.choice(trader_uids)
                dp  = random.choice(DELIVERY_PERIODS)
                dl  = random.choice(DELIVERY_LOCATIONS)
                lid = str(uuid.uuid4())
                ap  = random.choices([True, False], weights=[75, 25])[0]
                mq  = random.randint(5, max(5, int(qty * 0.3))) if ap else qty
                ts  = NOW - datetime.timedelta(minutes=random.randint(1, 120))

                all_listing_rows.append(
                    f"('{lid}', '{uid}', '{pid}', '{side_tag}', {p}, {qty}, "
                    f"0, 'OPEN', {q(dp)}, {q(dl)}, {'true' if ap else 'false'}, {mq}, "
                    f"'{fmt_time(ts)}', '{fmt_time(ts)}')")
                active_count += 1

                h = round(p * qty * MARGIN_RATE, 2)
                all_margin_rows.append(
                    f"('{str(uuid.uuid4())}', '{uid}', '{account_ids[uid]}', "
                    f"'{lid}', '{pid}', '{side_tag}', {p}, {qty}, {MARGIN_RATE}, {h}, 0, 'HELD', "
                    f"'{fmt_time(ts)}', '{fmt_time(ts)}')")
                bal = balances[uid]
                all_tx_rows.append(
                    f"('{str(uuid.uuid4())}', '{uid}', '{account_ids[uid]}', "
                    f"'FREEZE', {h}, {bal}, {bal - h}, 0, {h}, '冻结保证金-挂牌', '{fmt_time(ts)}')")
                balances[uid] = bal - h

    batch_insert(LISTING_HEADER, all_listing_rows)
    lines.append("")
    batch_insert(MARGIN_HEADER, all_margin_rows)
    lines.append("")
    batch_insert(TX_HEADER, all_tx_rows)
    lines.append("")
    print(f"  STEP4: {active_count} 个活跃挂牌（OPEN）+ 保证金 + 流水")
    all_listing_rows.clear()
    all_margin_rows.clear()
    all_tx_rows.clear()

    # ===== STEP 5: 部分成交（PARTIAL）=====
    lines.append("-- ===== STEP 5: 部分成交（PARTIAL） =====")
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
            ap     = random.choices([True, False], weights=[80, 20])[0]
            mq     = random.randint(5, max(5, int(qty * 0.3))) if ap else qty
            ts     = NOW - datetime.timedelta(minutes=random.randint(10, 240))

            all_listing_rows.append(
                f"('{lid}', '{uid}', '{pid}', '{side}', {p}, {qty}, "
                f"{filled}, 'PARTIAL', {q(dp)}, {q(dl)}, {'true' if ap else 'false'}, {mq}, "
                f"'{fmt_time(ts)}', '{fmt_time(ts)}')")
            partial_count += 1

            h = round(p * qty * MARGIN_RATE, 2)
            rel = round(h * filled / qty, 2)
            all_margin_rows.append(
                f"('{str(uuid.uuid4())}', '{uid}', '{account_ids[uid]}', "
                f"'{lid}', '{pid}', '{side}', {p}, {qty}, {MARGIN_RATE}, {h}, {rel}, 'HELD', "
                f"'{fmt_time(ts)}', '{fmt_time(NOW)}')")

    batch_insert(LISTING_HEADER, all_listing_rows)
    lines.append("")
    batch_insert(MARGIN_HEADER, all_margin_rows)
    lines.append("")
    print(f"  STEP5: {partial_count} 个部分成交（PARTIAL）+ 保证金部分释放")
    all_listing_rows.clear()
    all_margin_rows.clear()

    # ===== STEP 6: 已撤盘（CANCELLED）=====
    lines.append("-- ===== STEP 6: 已撤盘（CANCELLED） =====")
    cancelled_count = 0
    for product in PRODUCTS:
        pid = product["id"]
        mid = product_last_price.get(pid, product["base_price"])
        for _ in range(random.randint(1, 3)):
            p      = rand_price(mid, product["volatility"], 0.5)
            qty    = random.randint(20, 200)
            uid    = random.choice(trader_uids)
            side   = random.choice(["BUY", "SELL"])
            dp     = random.choice(DELIVERY_PERIODS)
            dl     = random.choice(DELIVERY_LOCATIONS)
            lid    = str(uuid.uuid4())
            ap     = random.choices([True, False], weights=[60, 40])[0]
            mq     = random.randint(5, max(5, int(qty * 0.3))) if ap else qty
            ts     = NOW - datetime.timedelta(hours=random.randint(2, 48))

            all_listing_rows.append(
                f"('{lid}', '{uid}', '{pid}', '{side}', {p}, {qty}, "
                f"0, 'CANCELLED', {q(dp)}, {q(dl)}, {'true' if ap else 'false'}, {mq}, "
                f"'{fmt_time(ts)}', '{fmt_time(NOW)}')")
            cancelled_count += 1

            h = round(p * qty * MARGIN_RATE, 2)
            all_margin_rows.append(
                f"('{str(uuid.uuid4())}', '{uid}', '{account_ids[uid]}', "
                f"'{lid}', '{pid}', '{side}', {p}, {qty}, {MARGIN_RATE}, {h}, {h}, 'CANCELLED', "
                f"'{fmt_time(ts)}', '{fmt_time(NOW)}')")
            bal = balances[uid]
            all_tx_rows.append(
                f"('{str(uuid.uuid4())}', '{uid}', '{account_ids[uid]}', "
                f"'UNFREEZE', {h}, {bal}, {bal + h}, {h}, 0, '撤盘释放保证金', '{fmt_time(NOW)}')")
            balances[uid] = bal + h

    batch_insert(LISTING_HEADER, all_listing_rows)
    lines.append("")
    batch_insert(MARGIN_HEADER, all_margin_rows)
    lines.append("")
    batch_insert(TX_HEADER, all_tx_rows)
    lines.append("")
    print(f"  STEP6: {cancelled_count} 个已撤盘（CANCELLED）+ 保证金释放 + UNFREEZE")
    all_listing_rows.clear()
    all_margin_rows.clear()
    all_tx_rows.clear()

    # ===== STEP 7: 已过期（EXPIRED）=====
    lines.append("-- ===== STEP 7: 已过期（EXPIRED） =====")
    expired_count = 0
    for product in PRODUCTS:
        pid = product["id"]
        mid = product_last_price.get(pid, product["base_price"])
        for _ in range(random.randint(1, 2)):
            p      = rand_price(mid, product["volatility"], 0.5)
            qty    = random.randint(20, 200)
            uid    = random.choice(trader_uids)
            side   = random.choice(["BUY", "SELL"])
            dp     = random.choice(DELIVERY_PERIODS)
            dl     = random.choice(DELIVERY_LOCATIONS)
            lid    = str(uuid.uuid4())
            ap     = random.choices([True, False], weights=[50, 50])[0]
            mq     = random.randint(5, max(5, int(qty * 0.3))) if ap else qty
            ts     = NOW - datetime.timedelta(days=random.randint(5, 30))

            all_listing_rows.append(
                f"('{lid}', '{uid}', '{pid}', '{side}', {p}, {qty}, "
                f"0, 'EXPIRED', {q(dp)}, {q(dl)}, {'true' if ap else 'false'}, {mq}, "
                f"'{fmt_time(ts)}', '{fmt_time(NOW)}')")
            expired_count += 1

    batch_insert(LISTING_HEADER, all_listing_rows)
    lines.append("")
    print(f"  STEP7: {expired_count} 个已过期（EXPIRED）")
    all_listing_rows.clear()

    # ===== STEP 8: 换盘挂牌 =====
    lines.append("-- ===== STEP 8: 换盘挂牌 =====")
    swap_batch = []
    swap_ids = []
    swap_count = 0

    swap_scenarios = [
        {"sell_pid": "benzene",     "buy_pid": "benzene",     "label": "苯换期",
         "sell_ap": True, "sell_min": 10, "buy_ap": True,  "buy_min": 10},
        {"sell_pid": "propylene",   "buy_pid": "propylene",   "label": "丙烯换期",
         "sell_ap": True, "sell_min": 5,  "buy_ap": False, "buy_min": 0},
        {"sell_pid": "phenol",      "buy_pid": "phenol",      "label": "苯酚换期",
         "sell_ap": False,"sell_min": 0,  "buy_ap": True,  "buy_min": 10},
        {"sell_pid": "acetone",     "buy_pid": "acetone",     "label": "丙酮换期",
         "sell_ap": True, "sell_min": 10, "buy_ap": True,  "buy_min": 10},
        {"sell_pid": "isopropanol", "buy_pid": "isopropanol", "label": "异丙醇换期",
         "sell_ap": False,"sell_min": 0,  "buy_ap": False, "buy_min": 0},
        {"sell_pid": "benzene",     "buy_pid": "propylene",   "label": "苯换丙烯",
         "sell_ap": True, "sell_min": 10, "buy_ap": True,  "buy_min": 10},
        {"sell_pid": "propylene",   "buy_pid": "phenol",      "label": "丙烯换苯酚",
         "sell_ap": True, "sell_min": 5,  "buy_ap": False, "buy_min": 0},
        {"sell_pid": "phenol",      "buy_pid": "acetone",     "label": "苯酚换丙酮",
         "sell_ap": False,"sell_min": 0,  "buy_ap": True,  "buy_min": 10},
        {"sell_pid": "acetone",     "buy_pid": "benzene",     "label": "丙酮换苯",
         "sell_ap": True, "sell_min": 10, "buy_ap": True,  "buy_min": 10},
        {"sell_pid": "mibk",        "buy_pid": "isopropanol", "label": "MIBK换异丙醇",
         "sell_ap": True, "sell_min": 5,  "buy_ap": True,  "buy_min": 5},
        {"sell_pid": "isopropanol", "buy_pid": "benzene",     "label": "异丙醇换苯",
         "sell_ap": False,"sell_min": 0,  "buy_ap": False, "buy_min": 0},
        {"sell_pid": "benzene",     "buy_pid": "mibk",        "label": "苯换MIBK",
         "sell_ap": True, "sell_min": 10, "buy_ap": True,  "buy_min": 10},
    ]

    for sc in swap_scenarios:
        spid = sc["sell_pid"]
        bpid = sc["buy_pid"]
        smid = product_last_price.get(spid, next(p["base_price"] for p in PRODUCTS if p["id"] == spid))
        bmid = product_last_price.get(bpid, next(p["base_price"] for p in PRODUCTS if p["id"] == bpid))
        sp = rand_price(smid, 0.02, 0.5)
        bp = rand_price(bmid, 0.02, 0.5)
        sq = random.randint(50, 300)
        bq = sq if spid == bpid else random.randint(50, 300)
        sdp = random.choice(DELIVERY_PERIODS)
        bdp = random.choice([d for d in DELIVERY_PERIODS if d != sdp]) if spid == bpid else random.choice(DELIVERY_PERIODS)
        sdl = random.choice(DELIVERY_LOCATIONS)
        bdl = random.choice(DELIVERY_LOCATIONS)
        uid = random.choice(trader_uids)
        sid = str(uuid.uuid4())
        ts  = NOW - datetime.timedelta(minutes=random.randint(5, 480))

        # 部分还盘进度
        if sc["sell_ap"] and random.random() < 0.6:
            sf = random.randint(int(sq * 0.1), int(sq * 0.7))
            bf = sf
            st = "OPEN"
        else:
            sf = bf = 0.0
            st = "OPEN"

        swap_batch.append(
            f"('{sid}', '{uid}', '{spid}', '{st}', "
            f"'{spid}', {sp}, {sq}, {sf}, {q(sdp)}, {q(sdl)}, "
            f"'{bpid}', {bp}, {bq}, {bf}, {q(bdp)}, {q(bdl)}, "
            f"{q(sc['label'])}, {'true' if sc['sell_ap'] or sc['buy_ap'] else 'false'}, "
            f"{'true' if sc['sell_ap'] else 'false'}, {sc['sell_min']}, "
            f"{'true' if sc['buy_ap'] else 'false'}, {sc['buy_min']}, "
            f"'{fmt_time(ts)}', '{fmt_time(ts)}')"
        )
        swap_ids.append((sid, uid))
        swap_count += 1

    # 额外随机换盘
    for _ in range(8):
        sp = random.choice(PRODUCTS)
        bp = random.choice(PRODUCTS)
        spid = sp["id"]
        bpid = bp["id"]
        smid = product_last_price.get(spid, sp["base_price"])
        bmid = product_last_price.get(bpid, bp["base_price"])
        spp = rand_price(smid, 0.025, 0.8)
        bpp = rand_price(bmid, 0.025, 0.8)
        sq = random.randint(30, 400)
        bq = sq if spid == bpid else random.randint(30, 400)
        sap = random.choices([True, False], weights=[70, 30])[0]
        bap = random.choices([True, False], weights=[70, 30])[0]
        smq = random.randint(5, max(5, int(sq * 0.3))) if sap else 0
        bmq = random.randint(5, max(5, int(bq * 0.3))) if bap else 0

        if sap and random.random() < 0.5:
            sf = random.randint(int(sq * 0.05), int(sq * 0.5))
            bf = sf
        else:
            sf = bf = 0.0

        sdp = random.choice(DELIVERY_PERIODS)
        bdp = random.choice(DELIVERY_PERIODS)
        sdl = random.choice(DELIVERY_LOCATIONS)
        bdl = random.choice(DELIVERY_LOCATIONS)
        uid = random.choice(trader_uids)
        sid = str(uuid.uuid4())
        ts  = NOW - datetime.timedelta(minutes=random.randint(1, 720))

        swap_batch.append(
            f"('{sid}', '{uid}', '{spid}', 'OPEN', "
            f"'{spid}', {spp}, {sq}, {sf}, {q(sdp)}, {q(sdl)}, "
            f"'{bpid}', {bpp}, {bq}, {bf}, {q(bdp)}, {q(bdl)}, "
            f"NULL, {'true' if sap or bap else 'false'}, "
            f"{'true' if sap else 'false'}, {smq}, "
            f"{'true' if bap else 'false'}, {bmq}, "
            f"'{fmt_time(ts)}', '{fmt_time(ts)}')"
        )
        swap_ids.append((sid, uid))
        swap_count += 1

    # MATCHED 换盘
    matched_swap_ids = []
    for _ in range(3):
        sp = random.choice(PRODUCTS)
        bp = random.choice(PRODUCTS)
        spid = sp["id"]
        bpid = bp["id"]
        smid = product_last_price.get(spid, sp["base_price"])
        bmid = product_last_price.get(bpid, bp["base_price"])
        spp = rand_price(smid, 0.02, 0.5)
        bpp = rand_price(bmid, 0.02, 0.5)
        sq = random.randint(50, 200)
        bq = sq
        sap = True
        bap = True
        smq = random.randint(5, max(5, int(sq * 0.3)))
        bmq = smq

        sdp = random.choice(DELIVERY_PERIODS)
        bdp = random.choice([d for d in DELIVERY_PERIODS if d != sdp])
        sdl = random.choice(DELIVERY_LOCATIONS)
        bdl = random.choice(DELIVERY_LOCATIONS)
        uid = random.choice(trader_uids)
        sid = str(uuid.uuid4())
        ts = NOW - datetime.timedelta(hours=random.randint(2, 24))

        swap_batch.append(
            f"('{sid}', '{uid}', '{spid}', 'MATCHED', "
            f"'{spid}', {spp}, {sq}, {sq}, {q(sdp)}, {q(sdl)}, "
            f"'{bpid}', {bpp}, {bq}, {bq}, {q(bdp)}, {q(bdl)}, "
            f"NULL, true, true, {smq}, true, {bmq}, "
            f"'{fmt_time(ts)}', '{fmt_time(NOW)}')"
        )
        swap_ids.append((sid, uid))
        matched_swap_ids.append(sid)
        swap_count += 1

    # 写入换盘
    SWAP_HEADER = (
        "INSERT INTO swap_listings ("
        "id, user_id, product_id, status, "
        "sell_product_id, sell_price, sell_quantity, sell_filled, "
        "sell_delivery_period, sell_delivery_location, "
        "buy_product_id, buy_price, buy_quantity, buy_filled, "
        "buy_delivery_period, buy_delivery_location, "
        "remark, allow_partial, "
        "sell_allow_partial, sell_min_quantity, "
        "buy_allow_partial, buy_min_quantity, "
        "created_at, updated_at"
        ") VALUES"
    )
    batch_insert(SWAP_HEADER, swap_batch)
    lines.append("")
    print(f"  STEP8: {swap_count} 个换盘挂牌（含 MATCHED）")

    # ===== STEP 9: 换盘匹配记录（swap_matches） =====
    lines.append("-- ===== STEP 9: 换盘匹配记录（swap_matches） =====")
    match_rows = []
    match_count = 0

    # 为 MATCHED 换盘生成匹配记录
    for msid in matched_swap_ids:
        mid = str(uuid.uuid4())
        uid = random.choice(trader_uids)
        # 匹配方（taker）的换盘 — 也做一个 MATCHED 的
        taker_sid = str(uuid.uuid4())
        sp = random.choice(PRODUCTS)
        bp = random.choice(PRODUCTS)
        spp = rand_price(product_last_price.get(sp["id"], sp["base_price"]), 0.02, 0.5)
        bpp = rand_price(product_last_price.get(bp["id"], bp["base_price"]), 0.02, 0.5)
        sq = random.randint(30, 150)
        sdp = random.choice(DELIVERY_PERIODS)
        bdp = random.choice(DELIVERY_PERIODS)
        sdl = random.choice(DELIVERY_LOCATIONS)
        bdl = random.choice(DELIVERY_LOCATIONS)

        match_rows.append(
            f"('{mid}', '{msid}', '{taker_sid}', '{uid}', "
            f"{sq}, {sq}, '{fmt_time(NOW - datetime.timedelta(minutes=random.randint(5, 60)))}')"
        )
        match_count += 1

    # 也为部分进度换盘生成一些匹配
    partial_swaps = [sid for sid, uid in swap_ids[:5]]
    for psid in partial_swaps[:3]:
        mid = str(uuid.uuid4())
        uid = random.choice(trader_uids)
        taker_sid = str(uuid.uuid4())
        sq = random.randint(20, 80)

        match_rows.append(
            f"('{mid}', '{psid}', '{taker_sid}', '{uid}', "
            f"{sq}, {sq}, '{fmt_time(NOW - datetime.timedelta(minutes=random.randint(10, 120)))}')"
        )
        match_count += 1

    SWAP_MATCH_HEADER = (
        "INSERT INTO swap_matches ("
        "id, swap_listing_id, counter_swap_id, matched_user_id, "
        "sell_matched_qty, buy_matched_qty, matched_at"
        ") VALUES"
    )
    batch_insert(SWAP_MATCH_HEADER, match_rows)
    lines.append("")
    print(f"  STEP9: {match_count} 条换盘匹配记录")

    # ===== STEP 10: 换盘保证金冻结 =====
    lines.append("-- ===== STEP 10: 换盘保证金冻结 =====")
    swap_margin_rows = []
    swap_margin_count = 0

    for sid, uid in swap_ids:
        # 找到对应换盘的价格和数量（简化：随机值）
        sp_price = random.randint(5000, 10000)
        sp_qty = random.randint(50, 300)
        bp_price = random.randint(5000, 10000)
        bp_qty = random.randint(50, 300)
        spid_pick = random.choice(PRODUCTS)["id"]
        bpid_pick = random.choice(PRODUCTS)["id"]

        # 卖腿保证金
        sh = round(sp_price * sp_qty * MARGIN_RATE, 2)
        swap_margin_rows.append(
            f"('{str(uuid.uuid4())}', '{uid}', '{account_ids[uid]}', "
            f"'{sid}', '{spid_pick}', 'SELL', "
            f"{sp_price}, {sp_qty}, {MARGIN_RATE}, {sh}, 0, 'HELD', "
            f"'{fmt_time(NOW - datetime.timedelta(minutes=random.randint(5, 480)))}', "
            f"'{fmt_time(NOW - datetime.timedelta(minutes=random.randint(1, 60)))}')"
        )
        # 买腿保证金
        bh = round(bp_price * bp_qty * MARGIN_RATE, 2)
        swap_margin_rows.append(
            f"('{str(uuid.uuid4())}', '{uid}', '{account_ids[uid]}', "
            f"'{sid}', '{bpid_pick}', 'BUY', "
            f"{bp_price}, {bp_qty}, {MARGIN_RATE}, {bh}, 0, 'HELD', "
            f"'{fmt_time(NOW - datetime.timedelta(minutes=random.randint(5, 480)))}', "
            f"'{fmt_time(NOW - datetime.timedelta(minutes=random.randint(1, 60)))}')"
        )
        swap_margin_count += 1

    # MATCHED 换盘的保证金部分释放
    for msid in matched_swap_ids:
        uid = random.choice(trader_uids)
        sp_price = random.randint(5000, 10000)
        sp_qty = random.randint(50, 200)
        bp_price = random.randint(5000, 10000)
        bp_qty = random.randint(50, 200)
        sh = round(sp_price * sp_qty * MARGIN_RATE, 2)
        bh = round(bp_price * bp_qty * MARGIN_RATE, 2)
        spid_pick = random.choice(PRODUCTS)["id"]
        bpid_pick = random.choice(PRODUCTS)["id"]

        swap_margin_rows.append(
            f"('{str(uuid.uuid4())}', '{uid}', '{account_ids[uid]}', "
            f"'{msid}', '{spid_pick}', 'SELL', "
            f"{sp_price}, {sp_qty}, {MARGIN_RATE}, {sh}, {sh}, 'RELEASED', "
            f"'{fmt_time(NOW - datetime.timedelta(hours=random.randint(2, 12)))}', "
            f"'{fmt_time(NOW)}')"
        )
        swap_margin_rows.append(
            f"('{str(uuid.uuid4())}', '{uid}', '{account_ids[uid]}', "
            f"'{msid}', '{bpid_pick}', 'BUY', "
            f"{bp_price}, {bp_qty}, {MARGIN_RATE}, {bh}, {bh}, 'RELEASED', "
            f"'{fmt_time(NOW - datetime.timedelta(hours=random.randint(2, 12)))}', "
            f"'{fmt_time(NOW)}')"
        )
        swap_margin_count += 1

    batch_insert(MARGIN_HEADER, swap_margin_rows)
    lines.append("")
    print(f"  STEP10: {swap_margin_count} 条换盘保证金记录")

    # ===== STEP 11: 站内消息（conversations + messages） =====
    lines.append("-- ===== STEP 11: 站内消息（conversations + messages） =====")
    conv_rows = []
    msg_rows = []

    # 系统通知会话（交易成功通知）
    for uid in trader_uids[:3]:
        cid = str(uuid.uuid4())
        conv_rows.append(
            f"('{cid}', '{SYSTEM_USER_ID}', '{uid}', "
            f"'system', true, '{fmt_time(NOW - datetime.timedelta(minutes=random.randint(10, 120)))}', "
            f"'{fmt_time(NOW - datetime.timedelta(minutes=random.randint(1, 10)))}')"
        )
        # 系统消息内容
        product = random.choice(PRODUCTS)
        pname = product["name"]
        price = rand_price(product["base_price"], product["volatility"])
        qty = random.randint(10, 50)
        msg_rows.append(
            f"('{str(uuid.uuid4())}', '{cid}', '{SYSTEM_USER_ID}', "
            f"'交易成功通知：您在{pname}的挂牌已有成交，成交价 {price} 元/吨，数量 {qty} 吨', "
            f"'{fmt_time(NOW - datetime.timedelta(minutes=random.randint(10, 120)))}')"
        )
        msg_rows.append(
            f"('{str(uuid.uuid4())}', '{cid}', '{uid}', "
            f"'收到，感谢通知', "
            f"'{fmt_time(NOW - datetime.timedelta(minutes=random.randint(1, 10)))}')"
        )

    # 用户间对话（买卖双方沟通）
    for _ in range(5):
        buid = random.choice(trader_uids)
        suid = random.choice([u for u in trader_uids if u != buid])
        cid = str(uuid.uuid4())
        conv_rows.append(
            f"('{cid}', '{buid}', '{suid}', "
            f"'private', false, "
            f"'{fmt_time(NOW - datetime.timedelta(hours=random.randint(1, 24)))}', "
            f"'{fmt_time(NOW - datetime.timedelta(minutes=random.randint(0, 30)))}')"
        )
        product = random.choice(PRODUCTS)
        pname = product["name"]
        base_p = product["base_price"]
        vol = product["volatility"]
        # 3-5 条消息
        for mi in range(random.randint(3, 5)):
            sender = buid if mi % 2 == 0 else suid
            period = random.choice(DELIVERY_PERIODS)
            rprice = rand_price(base_p, vol)
            contents = [
                f"您好，请问{pname} {period} 的货还有吗？",
                "有货的，价格可以商量",
                "什么价格？",
                f"{rprice} 元/吨，可以接受吗",
                "好的，我先挂个盘试试",
                "请问交割地点在哪？",
                f"{random.choice(DELIVERY_LOCATIONS)}",
                "可以安排运输吗？",
                "可以的，我们有自己的物流",
            ]
            content = random.choice(contents)
            ts = NOW - datetime.timedelta(minutes=random.randint(mi * 5, mi * 15 + 5))
            msg_rows.append(
                f"('{str(uuid.uuid4())}', '{cid}', '{sender}', "
                f"'{content}', '{fmt_time(ts)}')"
            )

    CONV_HEADER = (
        "INSERT INTO conversations ("
        "id, user1_id, user2_id, type, is_system, created_at, updated_at"
        ") VALUES"
    )
    MSG_HEADER = (
        "INSERT INTO messages ("
        "id, conversation_id, sender_id, content, created_at"
        ") VALUES"
    )
    batch_insert(CONV_HEADER, conv_rows)
    lines.append("")
    batch_insert(MSG_HEADER, msg_rows)
    lines.append("")
    print(f"  STEP11: {len(conv_rows)} 个会话 + {len(msg_rows)} 条消息")

    # ===== STEP 12: COMMIT + 统计 =====
    lines.append("")
    lines.append("COMMIT;")
    lines.append("")
    lines.append("-- ===== 数据统计 =====")
    for tbl in ["users", "accounts", "transactions", "listings", "trades",
                "swap_listings", "swap_matches", "margin_holds",
                "conversations", "messages"]:
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
    print("Snail Chemical Trade - 测试数据生成器 v3")
    print("=" * 60)
    print(f"目标服务器: {HOST}")
    print(f"历史数据天数: {HISTORY_DAYS} 天")
    print(f"K线间隔: {CANDLE_INTERVAL} 分钟")
    print(f"产品数: {len(PRODUCTS)}")
    print(f"测试用户数: {len(TEST_USERS) + 1} (含 admin + system)")
    print()

    # ---- Step 0: 先查出当前用户 UUID ----
    print("[0/5] 连接服务器，查询现有用户...")
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

    # ---- Step 1: 本地生成 SQL ----
    print("[1/5] 本地生成 SQL 文件...")
    sql_content = generate_sql(user_ids_fixed)
    sql_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_test_data_v3.sql")
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write(sql_content)
    sql_size = os.path.getsize(sql_path) / 1024 / 1024
    print(f"  SQL 文件: {sql_path} ({sql_size:.2f} MB)")

    # ---- Step 2: 上传 ----
    print("[2/5] 上传 SQL 到服务器...")
    sftp = ssh.open_sftp()
    remote_sql = "/tmp/seed_test_data_v3.sql"
    sftp.put(sql_path, remote_sql)
    sftp.close()
    print(f"  已上传 {remote_sql}")

    # ---- Step 3: 执行 SQL ----
    print("[3/5] 执行 SQL（可能需要 1-3 分钟）...")
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
    print("[4/5] 验证数据量...")
    tables = [
        "users", "accounts", "transactions",
        "listings", "trades",
        "swap_listings", "swap_matches",
        "margin_holds", "conversations", "messages",
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

    # 挂牌状态分布
    print("\n  挂牌状态分布:")
    ls_stats = run_ssh(
        ssh,
        f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} "
        f"-t -A -F'|' -c "
        f"\"SELECT status, COUNT(*) FROM listings GROUP BY status ORDER BY status;\" 2>&1",
        timeout=15,
    )
    for line in ls_stats.strip().split("\n"):
        if "|" in line:
            parts = line.split("|")
            if len(parts) >= 2:
                print(f"    {parts[0]:<14}: {parts[1]:>6} 个")

    # 换盘统计
    print("\n  换盘状态分布:")
    swap_stats = run_ssh(
        ssh,
        f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} "
        f"-t -A -F'|' -c "
        f"\"SELECT status, COUNT(*) FROM swap_listings GROUP BY status ORDER BY status;\" 2>&1",
        timeout=15,
    )
    for line in swap_stats.strip().split("\n"):
        if "|" in line:
            parts = line.split("|")
            if len(parts) >= 2:
                print(f"    {parts[0]:<14}: {parts[1]:>6} 个")

    # 重启后端让引擎重载订单簿
    print("\n[5/5] 重启后端服务（重载订单簿）...")
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