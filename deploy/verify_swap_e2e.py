"""端到端验证：换盘成交生成 trades + 状态 MATCHED（带清理）

验证点：
1. 双向换盘(both)成交后，发起方(A)与接受方(B)的「我的成交」各出现 2 条 source='swap' 成交
2. 发起方(A)「我的换盘」该换盘状态变为 MATCHED
3. 验证后通过 psql 清理 trades / swap_matches / swap_listings 记录（及测试账号）
"""
import json
import time
import urllib.request
import urllib.error
import paramiko

BASE = "https://api.snailchemical.com"
HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
DB = "postgres://snailtrade:snailtrade2024@127.0.0.1:5432/snailtrade?sslmode=disable"

TS = int(time.time())
UA = f"e2e_verify_a_{TS}"
UB = f"e2e_verify_b_{TS}"
PW = "E2eTest123!"

created = {"swap_id": None, "match_id": None, "users": []}


def post(path, body, token=None):
    data = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {"error": e.reason}
    except Exception as e:
        return 0, {"error": str(e)}


def get(path, token):
    req = urllib.request.Request(BASE + path, method="GET")
    req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {"error": e.reason}
    except Exception as e:
        return 0, {"error": str(e)}


def psql(ssh, sql):
    cmd = f'psql "{DB}" -tA -c {sql!r}'
    _, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    return out, err


def main():
    print("=== 1. 注册测试账号 ===")
    sa, body_a = post("/api/v1/auth/register", {"username": UA, "password": PW})
    sb, body_b = post("/api/v1/auth/register", {"username": UB, "password": PW})
    print(f"  A register: {sa} token?={'token' in body_a}")
    print(f"  B register: {sb} token?={'token' in body_b}")
    if "token" not in body_a or "token" not in body_b:
        print("  注册失败，终止:", body_a, body_b)
        return
    tok_a = body_a["token"]
    tok_b = body_b["token"]
    created["users"] = [body_a.get("user", {}).get("id"), body_b.get("user", {}).get("id")]

    print("=== 2. A 发布双向换盘 ===")
    # 卖出 benzene / 换入 propylene，数量一致=10
    swap_body = {
        "sell_product_id": "benzene",
        "sell_price": 7000,
        "sell_quantity": 10,
        "sell_delivery_period": "现货",
        "sell_payment_method": "先款后货",
        "buy_product_id": "propylene",
        "buy_price": 8000,
        "buy_quantity": 10,
        "buy_delivery_period": "现货",
        "buy_payment_method": "先款后货",
    }
    sc, swap_resp = post("/api/v1/swaps", swap_body, tok_a)
    print(f"  create swap: {sc} resp={swap_resp}")
    if sc != 200 or "swap" not in swap_resp:
        print("  发布换盘失败，终止")
        return
    swap = swap_resp["swap"]
    created["swap_id"] = swap["id"]
    print(f"  swap_id={created['swap_id']} serial_no={swap.get('serial_no')} status={swap.get('status')}")

    print("=== 3. B 双向成交(both) ===")
    mc, match_resp = post(f"/api/v1/swaps/{created['swap_id']}/match", {}, tok_b)
    print(f"  match: {mc} resp={match_resp}")
    if mc != 200 or "match_id" not in match_resp:
        print("  成交失败，终止")
        cleanup()
        return
    created["match_id"] = match_resp["match_id"]
    print(f"  match_id={created['match_id']} match_side={match_resp.get('match_side')}")
    print(f"  sell_filled={match_resp.get('sell_filled')} buy_filled={match_resp.get('buy_filled')}")

    print("=== 4. 校验 A 我的成交 ===")
    ta, trades_a = get("/api/v1/trades/mine?limit=20", tok_a)
    print(f"  A trades: {ta}")
    check_trades("A", trades_a)

    print("=== 5. 校验 B 我的成交 ===")
    tb, trades_b = get("/api/v1/trades/mine?limit=20", tok_b)
    print(f"  B trades: {tb}")
    check_trades("B", trades_b)

    print("=== 6. 校验 A 我的换盘状态 ===")
    _, swaps_a = get("/api/v1/swaps/mine", tok_a)
    lst = swaps_a.get("data", []) if isinstance(swaps_a, dict) else []
    target = next((s for s in lst if s["id"] == created["swap_id"]), None)
    if target:
        print(f"  A 该换盘 status={target.get('status')} (期望 MATCHED)")
        print(f"  A 该换盘 sell_filled={target.get('sell_filled')} buy_filled={target.get('buy_filled')}")
    else:
        print("  A 我的换盘未找到该换盘")

    print("=== 7. 校验成交记录的 source 与双边用户 ===")
    verify_swap_trades(swap, trades_a, trades_b)

    print("=== 8. 清理测试数据 ===")
    cleanup()
    print("\nE2E 验证完成。")


def check_trades(who, resp):
    lst = resp.get("data", []) if isinstance(resp, dict) else []
    swap_trades = [t for t in lst if t.get("source") == "swap"]
    print(f"  {who}: 共 {len(lst)} 条成交，其中 source=swap {len(swap_trades)} 条")
    for t in swap_trades:
        print(f"    - product={t.get('product_id')} price={t.get('price')} qty={t.get('quantity')} "
              f"buyer={str(t.get('buy_user_id'))[:8]} seller={str(t.get('sell_user_id'))[:8]} "
              f"source={t.get('source')}")


def verify_swap_trades(swap, trades_a, trades_b):
    allt = []
    for resp in (trades_a, trades_b):
        lst = resp.get("data", []) if isinstance(resp, dict) else []
        allt += [t for t in lst if t.get("source") == "swap"]
    # 应含 benzene(卖腿) + propylene(买腿) 各两条（A、B 各见全量）
    products = {}
    for t in allt:
        products.setdefault(t.get("product_id"), 0)
        products[t["product_id"]] += 1
    print(f"  swap 成交涉及品种计数: {products}")
    print(f"  A 见到的 swap 成交数: {sum(1 for t in trades_a.get('data', []) if t.get('source')=='swap')}")
    print(f"  B 见到的 swap 成交数: {sum(1 for t in trades_b.get('data', []) if t.get('source')=='swap')}")


def cleanup():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)
    mid = created.get("match_id")
    sid = created.get("swap_id")
    if mid:
        _, e1 = psql(ssh, f"DELETE FROM trades WHERE buy_order_id='{mid}';")
        _, e2 = psql(ssh, f"DELETE FROM swap_matches WHERE id='{mid}';")
        print(f"  清理 trades(按 buy_order_id): err={e1}")
        print(f"  清理 swap_matches: err={e2}")
    if sid:
        _, e3 = psql(ssh, f"DELETE FROM swap_listings WHERE id='{sid}';")
        print(f"  清理 swap_listings: err={e3}")
    # 尝试删除测试账号（忽略 FK 失败）
    for uid in created.get("users", []):
        if uid:
            _, e = psql(ssh, f"DELETE FROM users WHERE id='{uid}';")
            if e:
                print(f"  删除测试账号 {uid[:8]} 跳过(FK限制): {e[:60]}")
    ssh.close()


if __name__ == "__main__":
    main()
