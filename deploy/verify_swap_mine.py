"""聚焦验证：A 发布换盘并成交后，A 的 swaps/mine 是否返回该换盘且 status=MATCHED"""
import json, time, urllib.request, urllib.error, paramiko

BASE = "https://api.snailchemical.com"
HOST = "115.159.64.125"; USER="root"; PASSWORD="Kai&19920310"
DB = "postgres://snailtrade:snailtrade2024@127.0.0.1:5432/snailtrade?sslmode=disable"
TS = int(time.time())
UA = f"e2e_b_{TS}"; UB = f"e2e_c_{TS}"; PW="E2eTest123!"
state = {}

def post(p, b, tok=None):
    d = json.dumps(b).encode()
    r = urllib.request.Request(BASE+p, data=d, method="POST")
    r.add_header("Content-Type","application/json")
    if tok: r.add_header("Authorization","Bearer "+tok)
    try:
        with urllib.request.urlopen(r, timeout=30) as x: return x.status, json.loads(x.read().decode())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except: return e.code, {"error":e.reason}

def get(p, tok):
    r = urllib.request.Request(BASE+p, method="GET")
    r.add_header("Authorization","Bearer "+tok)
    try:
        with urllib.request.urlopen(r, timeout=30) as x: return x.status, json.loads(x.read().decode())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except: return e.code, {"error":e.reason}

def psql(ssh, sql):
    c = f'psql "{DB}" -tA -c {sql!r}'
    _,o,e = ssh.exec_command(c, timeout=30)
    return o.read().decode().strip(), e.read().decode().strip()

sa, ba = post("/api/v1/auth/register", {"username":UA,"password":PW})
sb, bb = post("/api/v1/auth/register", {"username":UB,"password":PW})
tok_a = ba["token"]; tok_b = bb["token"]
state["ua"]=ba.get("user",{}).get("id"); state["ub"]=bb.get("user",{}).get("id")

sc, swap = post("/api/v1/swaps", {
    "sell_product_id":"benzene","sell_price":7000,"sell_quantity":10,"sell_delivery_period":"现货","sell_payment_method":"先款后货",
    "buy_product_id":"propylene","buy_price":8000,"buy_quantity":10,"buy_delivery_period":"现货","buy_payment_method":"先款后货"}, tok_a)
sid = swap["swap"]["id"]
state["sid"]=sid
print(f"swap created: {sid}")

mc, m = post(f"/api/v1/swaps/{sid}/match", {}, tok_b)
print(f"match: {mc} match_id={m.get('match_id')}")
state["mid"]=m.get("match_id")

# 关键：查询 A 的 swaps/mine
st, sm = get("/api/v1/swaps/mine", tok_a)
print(f"A swaps/mine status={st}")
lst = sm.get("data", []) if isinstance(sm, dict) else []
print(f"A swaps/mine 返回 {len(lst)} 条")
for s in lst:
    print(f"  - id={s['id']} serial={s.get('serial_no')} status={s.get('status')} sell_filled={s.get('sell_filled')} buy_filled={s.get('buy_filled')}")
    if s["id"]==sid:
        print(f"    >>> 命中目标换盘，status={s.get('status')} (期望 MATCHED)")

# 清理
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)
psql(ssh, f"DELETE FROM trades WHERE buy_order_id='{state['mid']}';")
psql(ssh, f"DELETE FROM swap_matches WHERE id='{state['mid']}';")
psql(ssh, f"DELETE FROM swap_listings WHERE id='{state['sid']}';")
for u in (state.get("ua"), state.get("ub")):
    if u: psql(ssh, f"DELETE FROM users WHERE id='{u}';")
ssh.close()
print("cleanup done")
