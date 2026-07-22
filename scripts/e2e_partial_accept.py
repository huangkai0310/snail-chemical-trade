"""Live E2E: 议价条款级部分接受全流程（针对 #536/#535 部署验证）。
流程：注册两用户 -> 开户充值 -> A 建可议挂牌 -> B 发起多条款议价 ->
A 部分接受(价格+数量) -> B 二次确认拒绝(无成交) ->
B 再发议价 -> A 部分接受 -> B 二次确认接受(成交, 验证条款回退) ->
验证 sibling PENDING 被置为已撤销(已成交) -> 清理测试数据。
"""
import json, time, urllib.request, urllib.error

BASE = "https://api.snailchemical.com/api/v1"
TS = str(int(time.time()))


def call(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {"error": e.read().decode()[:200]}


def get_co_status(token, co_id, listing_id):
    s, j = call("GET", f"/counter-offers/by-ref?ref_type=listing&ref_id={listing_id}", token)
    if s != 200:
        return None, None, str(j)[:80]
    items = j.get("data", [])
    for it in items:
        if it.get("id") == co_id:
            return it.get("status"), it.get("cancel_reason"), ""
    return None, None, "not found in by-ref"


def reg(name):
    s, j = call("POST", "/auth/register", body={"username": name, "password": "Test123456"})
    assert s == 200 and "token" in j, f"register {name} failed: {s} {j}"
    return j["token"], j.get("user", {}).get("id")


def open_deposit(token, amt=200000):
    s, j = call("GET", "/account", token)
    assert s == 200, f"get account failed {s} {j}"
    s, j = call("POST", "/account/deposit", token, {"amount": amt})
    assert s == 200, f"deposit failed {s} {j}"


results = []
def check(name, cond, extra=""):
    results.append((name, cond, extra))
    print(("PASS " if cond else "FAIL ") + name + ("  " + extra if extra else ""))


print("=== 1. 注册用户 ===")
tokA, uidA = reg(f"e2e_a_{TS}")
time.sleep(0.6)
tokB, uidB = reg(f"e2e_b_{TS}")
check("注册用户A", True, uidA[:8])
check("注册用户B", True, uidB[:8])

print("=== 2. 开户+充值 ===")
open_deposit(tokA)
open_deposit(tokB)
check("A 开户充值", True)
check("B 开户充值", True)

print("=== 3. A 建可议挂牌(SELL 苯 100@7000, 全条款可议) ===")
s, j = call("POST", "/listings", tokA, {
    "product_id": "benzene", "side": "SELL", "price": 7000, "quantity": 100,
    "allow_counter_offer": True,
    "negotiable_terms": ["price", "quantity", "payment_method", "delivery_period",
                         "delivery_location", "delivery_method", "free_storage", "specs"],
    "payment_method": "款到发货", "delivery_period": "2026-07",
})
check("A 建挂牌", s == 200, f"status={s}")
listing_id = j.get("listing", {}).get("id") or j.get("data", {}).get("id") or j.get("id")
check("拿到 listing_id", bool(listing_id), listing_id or str(j)[:120])

print("=== 4. B 发起多条款议价(价格+数量+付款方式+交割期) ===")
s, j = call("POST", "/counter-offers", tokB, {
    "ref_type": "listing", "ref_id": listing_id,
    "offer_price": 6900, "offer_quantity": 50,
    "offer_payment_method": "货到付款", "offer_delivery_period": "2026-08",
})
check("B 发起议价 CO1", s == 200, f"status={s}")
co1 = j.get("data", {}).get("id")
check("CO1 创建", bool(co1), co1 or str(j)[:80])

print("=== 5. A 部分接受(仅价格+数量) -> PARTIAL_ACCEPTED ===")
s, j = call("POST", f"/counter-offers/{co1}/accept", tokA,
            {"accepted_terms": ["price", "quantity"]})
check("A 部分接受 CO1", s == 200, f"status={s} msg={j.get('message')}")
st1, _, _ = get_co_status(tokA, co1, listing_id)
check("CO1 状态=PARTIAL_ACCEPTED", st1 == "PARTIAL_ACCEPTED", f"status={st1}")

print("=== 6. B 二次确认 拒绝 -> CANCELLED (无成交) ===")
s, j = call("POST", f"/counter-offers/{co1}/respond", tokB, {"action": "reject"})
check("B 拒绝部分接受", s == 200, f"status={s} msg={j.get('message')}")
st1r, _, _ = get_co_status(tokB, co1, listing_id)
check("CO1 状态=CANCELLED", st1r == "CANCELLED", f"status={st1r}")

print("=== 7. B 再发议价 CO2 + A 部分接受 + B 二次确认接受(成交) ===")
s, j = call("POST", "/counter-offers", tokB, {
    "ref_type": "listing", "ref_id": listing_id,
    "offer_price": 6850, "offer_quantity": 40,
    "offer_payment_method": "货到付款",
})
co2 = j.get("data", {}).get("id")
check("B 发起议价 CO2", s == 200 and bool(co2), f"status={s}")
s, j = call("POST", f"/counter-offers/{co2}/accept", tokA, {"accepted_terms": ["price", "quantity"]})
check("A 部分接受 CO2", s == 200, f"status={s}")
s, j = call("POST", f"/counter-offers/{co2}/respond", tokB, {"action": "accept"})
check("B 确认接受(成交)", s == 200, f"status={s} err={j.get('error')} body={j}")
trade = j.get("trade")
check("成交生成 trade", bool(trade), f"trade_id={ (trade or {}).get('id','') }")
st2, _, _ = get_co_status(tokB, co2, listing_id)
check("CO2 状态=ACCEPTED", st2 == "ACCEPTED", f"status={st2}")

print("=== 8. 条款回退验证: 付款方式未接受, 应回退原盘'款到发货' ===")
tid = (trade or {}).get("id")
spm = None
if tid:
    s, j = call("GET", "/trades/mine", tokB)
    items = j.get("data", [])
    for it in items:
        if it.get("id") == tid:
            spm = it.get("sell_payment_method") or it.get("payment_method")
            break
    check("成交付款方式回退原盘", spm == "款到发货", f"sell_payment_method={spm}")
else:
    check("成交付款方式回退原盘", False, "no trade id")

print("=== 9. sibling 撤销验证: CO3/CO4 同盘 -> 部分接受 CO3 -> CO4 已撤销(已成交) ===")
s, j = call("POST", "/counter-offers", tokB, {
    "ref_type": "listing", "ref_id": listing_id,
    "offer_price": 6800, "offer_quantity": 10,
    "offer_payment_method": "货到付款", "offer_delivery_period": "2026-09",
})
co3 = j.get("data", {}).get("id")
s, j = call("POST", "/counter-offers", tokB, {
    "ref_type": "listing", "ref_id": listing_id,
    "offer_price": 6790, "offer_quantity": 10,
})
co4 = j.get("data", {}).get("id")
check("CO3/CO4 创建", bool(co3) and bool(co4), f"{co3} {co4}")
s, j = call("POST", f"/counter-offers/{co3}/accept", tokA, {"accepted_terms": ["price", "quantity"]})
check("CO3 部分接受", s == 200, f"accept_status={s} err={j.get('error')}")
s, j = call("POST", f"/counter-offers/{co3}/respond", tokB, {"action": "accept"})
check("CO3 确认成交", s == 200, f"status={s} err={j.get('error')}")
st4, reason4, _ = get_co_status(tokB, co4, listing_id)
check("CO4=sibling已撤销(已成交)", st4 == "CANCELLED" and reason4 == "已成交", f"status={st4} reason={reason4}")

print("=== 10. 清理测试数据 ===")
import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("115.159.64.125", port=22, username="root", password="Kai&19920310", timeout=30)
def run(c):
    _, o, e = ssh.exec_command(c, timeout=30)
    return (o.read() + e.read()).decode().strip()
env = run("cat /opt/snailtrade/.env")
import re
m = re.search(r'postgres://([^:]+):([^@]+)@([^/:]+):?(\d*)/(\w+)', env)
u, pw, h, p, db = m.groups()
p = p or "5432"
# 用 username LIKE 'e2e_%' 清理所有测试残渣(含上轮孤儿挂牌)
ids = run(f"PGPASSWORD={pw} psql -h {h} -p {p} -U {u} -d {db} -tAc \"SELECT id FROM users WHERE username LIKE 'e2e_%'\"")
user_ids = [x.strip() for x in ids.split("\n") if x.strip()]
idlist = ",".join(f"'{i}'" for i in user_ids) if user_ids else "''"
clean = (
    f"PGPASSWORD={pw} psql -h {h} -p {p} -U {u} -d {db} -c "
    f"\"DELETE FROM trades WHERE buy_order_id IN (SELECT id FROM listings WHERE user_id IN ({idlist})) "
    f"OR sell_order_id IN (SELECT id FROM listings WHERE user_id IN ({idlist}));"
    f" DELETE FROM counter_offers WHERE ref_id IN (SELECT id FROM listings WHERE user_id IN ({idlist}));"
    f" DELETE FROM listings WHERE user_id IN ({idlist});"
    f" DELETE FROM accounts WHERE user_id IN ({idlist});"
    f" DELETE FROM users WHERE username LIKE 'e2e_%';\""
)
out = run(clean)
check("清理测试数据(e2e_%)", "DELETE" in out, out[:200])
ssh.close()

print("\n=== 汇总 ===")
passed = sum(1 for _, c, _ in results if c)
for n, c, e in results:
    print(("PASS " if c else "FAIL ") + n)
print(f"\n{passed}/{len(results)} checks passed")
