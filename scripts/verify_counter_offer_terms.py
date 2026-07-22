"""
E2E 验证：议价可协商更多元素（交割期/交割地/付款方式/交割方式/免仓/规格）
- 列表(listing)路径：还价提供协商条款 → 接受成交 → trades 记录以协商条款覆盖原盘
- 换盘(swap)路径：还价提供部分协商条款 → 接受成交 → 提供的覆盖、未提供的回退到换盘原条款
运行前提：前后端已部署，迁移 024 已执行。
直接打公网 API（与 deploy 脚本健康检查同源）。
"""
import json
import requests
import sys
import time

BASE = "https://api.snailchemical.com"
API = BASE + "/api/v1"
PW = "Test123456"

try:
    from urllib3.exceptions import InsecureRequestWarning
    requests.packages.urllib3.disable_warnings(InsecureRequestWarning)
except Exception:
    pass


def ts():
    return str(int(time.time() * 1000))


def reg(u):
    r = requests.post(f"{API}/auth/register", json={"username": u, "password": PW}, verify=False)
    return r


def login(u):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": PW}, verify=False)
    r.raise_for_status()
    return r.json()["token"]


def ensure_account(tok, amount):
    # GetAccount 内部 GetOrCreate，确保账户存在；随后充值足够保证金
    requests.get(f"{API}/account", headers={"Authorization": f"Bearer {tok}"}, verify=False)
    r = requests.post(f"{API}/account/deposit", json={"amount": amount, "remark": "e2e"},
                     headers={"Authorization": f"Bearer {tok}"}, verify=False)
    return r


def products():
    r = requests.get(f"{API}/products", verify=False)
    r.raise_for_status()
    d = r.json()
    if isinstance(d, dict):
        return d.get("data") or []
    return d  # 直接是数组


def create_listing(tok, product, side, price, qty, **extra):
    body = {"product_id": product, "side": side, "price": price, "quantity": qty,
            "allow_counter_offer": True}
    body.update(extra)
    r = requests.post(f"{API}/listings", json=body,
                      headers={"Authorization": f"Bearer {tok}"}, verify=False)
    return r


def listing_id_of(r):
    j = r.json()
    for key in ("listing", "data"):
        if key in j and isinstance(j[key], dict) and "id" in j[key]:
            return j[key]["id"]
    if "id" in j:
        return j["id"]
    raise RuntimeError(f"cannot extract listing id from {json.dumps(j, ensure_ascii=False)[:300]}")


def create_counter(tok, ref_type, ref_id, price, qty, **offer):
    body = {"ref_type": ref_type, "ref_id": ref_id, "offer_price": price, "offer_quantity": qty}
    body.update(offer)
    r = requests.post(f"{API}/counter-offers", json=body,
                      headers={"Authorization": f"Bearer {tok}"}, verify=False)
    return r


def accept_counter(tok, coid):
    r = requests.post(f"{API}/counter-offers/{coid}/accept",
                      headers={"Authorization": f"Bearer {tok}"}, verify=False)
    return r


def trades_mine(tok, product=None):
    url = f"{API}/trades/mine"
    if product:
        url += f"?product_id={product}"
    r = requests.get(url, headers={"Authorization": f"Bearer {tok}"}, verify=False)
    r.raise_for_status()
    j = r.json()
    return j.get("data") or []


def find_trade(trades, sell_order_id=None, buy_order_id=None):
    for t in trades:
        if sell_order_id and t.get("sell_order_id") == sell_order_id:
            return t
        if buy_order_id and t.get("buy_order_id") == buy_order_id:
            return t
    return None


def section(title):
    print("\n" + "=" * 60)
    print(title)
    print("=" * 60)


def norm_specs(x):
    """规格在 API 中可能以字符串(含 JSON)或对象返回，统一解析为 dict 比较"""
    if isinstance(x, str):
        try:
            return json.loads(x)
        except Exception:
            return x
    return x


def main():
    tag = ts()
    u1 = f"e2e_a_{tag}"
    u2 = f"e2e_b_{tag}"

    section("0. 准备账号 + 选品种")
    for u in (u1, u2):
        r = reg(u)
        assert r.status_code in (200, 409), f"注册 {u} 失败: {r.status_code} {r.text[:200]}"
    t1 = login(u1)
    t2 = login(u2)
    print(f"  {u1} / {u2} 登录 OK")
    # 开户 + 充值保证金（建盘/建换盘需要冻结保证金）
    for tok, who in ((t1, u1), (t2, u2)):
        r = ensure_account(tok, 10_000_000_000)
        assert r.status_code == 200, f"{who} 充值失败: {r.status_code} {r.text[:200]}"
    print("  开户+充值 OK")
    prods = products()
    assert prods, "无品种"
    pid = prods[0]["id"]
    print(f"  选用品种: {pid}")

    problems = []

    # ============ 列表路径 ============
    section("1. 列表(listing)路径：协商条款覆盖原盘")
    orig_dp, orig_pm, orig_dm = "2026-09", "先款后货", "自提"
    orig_specs = {"grade": "国标优等品", "package": "桶装"}
    r = create_listing(t1, pid, "SELL", 9999999, 100,
                       delivery_period=orig_dp, delivery_location="华东",
                       payment_method=orig_pm, delivery_method=orig_dm,
                       free_storage_enabled=True, free_storage_days=30,
                       specs=orig_specs)
    assert r.status_code == 200, f"建盘失败: {r.status_code} {r.text[:300]}"
    lid = listing_id_of(r)
    print(f"  原盘 {lid}: dp={orig_dp} pm={orig_pm} dm={orig_dm}")

    off_dp, off_pm, off_dm, off_dl = "2026-12", "货到付款", "送到", "华北"
    off_specs = {"grade": "食品级", "package": "槽车"}
    r = create_counter(t2, "listing", lid, 9999998, 50,
                       offer_delivery_period=off_dp,
                       offer_delivery_location=off_dl,
                       offer_payment_method=off_pm,
                       offer_delivery_method=off_dm,
                       offer_free_storage_enabled=True,
                       offer_free_storage_days=45,
                       offer_specs=json.dumps(off_specs))
    assert r.status_code == 200, f"发起议价失败: {r.status_code} {r.text[:400]}"
    co = r.json().get("data") or r.json()
    coid = co["id"]
    # 校验持久化
    persisted = {k: co.get(k) for k in ("offer_delivery_period", "offer_delivery_location",
                                        "offer_payment_method", "offer_delivery_method",
                                        "offer_free_storage_enabled", "offer_free_storage_days",
                                        "offer_specs")}
    print(f"  议价 {coid} 持久化: {json.dumps(persisted, ensure_ascii=False)}")
    for k, v in (("offer_delivery_period", off_dp), ("offer_payment_method", off_pm),
                 ("offer_specs", json.dumps(off_specs))):
        if co.get(k) != v:
            problems.append(f"[listing] 持久化 {k} 期望 {v} 实际 {co.get(k)}")

    r = accept_counter(t1, coid)
    assert r.status_code == 200, f"接受议价失败: {r.status_code} {r.text[:400]}"
    print("  已接受")

    tr = find_trade(trades_mine(t1, pid), sell_order_id=lid)
    assert tr, f"未找到成交记录(原盘 {lid})。trades 样本: {json.dumps(trades_mine(t1, pid)[:2], ensure_ascii=False)[:400]}"
    print(f"  成交记录: dp={tr.get('delivery_period')} dl={tr.get('delivery_location')} "
          f"dm={tr.get('delivery_method')} fse={tr.get('free_storage_enabled')} fsd={tr.get('free_storage_days')} "
          f"buy_pm={tr.get('buy_payment_method')} sell_pm={tr.get('sell_payment_method')}")
    print(f"  buy_specs={json.dumps(tr.get('buy_specs'), ensure_ascii=False)} "
          f"sell_specs={json.dumps(tr.get('sell_specs'), ensure_ascii=False)}")

    if tr.get("delivery_period") != off_dp:
        problems.append(f"[listing] delivery_period 期望 {off_dp} 实际 {tr.get('delivery_period')}")
    if tr.get("delivery_location") != off_dl:
        problems.append(f"[listing] delivery_location 期望 {off_dl} 实际 {tr.get('delivery_location')}")
    if tr.get("delivery_method") != off_dm:
        problems.append(f"[listing] delivery_method 期望 {off_dm} 实际 {tr.get('delivery_method')}")
    if tr.get("free_storage_enabled") is not True:
        problems.append(f"[listing] free_storage_enabled 期望 True 实际 {tr.get('free_storage_enabled')}")
    if tr.get("free_storage_days") != 45:
        problems.append(f"[listing] free_storage_days 期望 45 实际 {tr.get('free_storage_days')}")
    if tr.get("buy_payment_method") != off_pm:
        problems.append(f"[listing] buy_payment_method 期望 {off_pm} 实际 {tr.get('buy_payment_method')}")
    # 卖方(sell) 付款方式维持原盘
    if tr.get("sell_payment_method") != orig_pm:
        problems.append(f"[listing] sell_payment_method 期望原盘 {orig_pm} 实际 {tr.get('sell_payment_method')}")
    if norm_specs(tr.get("buy_specs")) != off_specs:
        problems.append(f"[listing] buy_specs 期望 {off_specs} 实际 {tr.get('buy_specs')}")
    if norm_specs(tr.get("sell_specs")) != orig_specs:
        problems.append(f"[listing] sell_specs 期望原盘 {orig_specs} 实际 {tr.get('sell_specs')}")

    # ============ 换盘路径 ============
    section("2. 换盘(swap)路径：提供项覆盖 + 未提供项回退原盘")
    sell_dp, sell_pm, sell_dm, sell_dl = "2026-09", "先款后货", "自提", "华东"
    sell_specs = {"grade": "国标优等品"}
    buy_dp, buy_pm, buy_dm, buy_dl = "2026-10", "货到付款", "送到", "华南"
    buy_specs = {"grade": "工业级"}
    swap_body = {
        "sell_product_id": pid, "sell_price": 9999999, "sell_quantity": 50,
        "sell_delivery_period": sell_dp, "sell_delivery_location": sell_dl,
        "sell_payment_method": sell_pm, "sell_delivery_method": sell_dm,
        "sell_free_storage_enabled": True, "sell_free_storage_days": 30,
        "sell_specs": sell_specs,
        "buy_product_id": pid, "buy_price": 100, "buy_quantity": 50,
        "buy_delivery_period": buy_dp, "buy_delivery_location": buy_dl,
        "buy_payment_method": buy_pm, "buy_delivery_method": buy_dm,
        "buy_free_storage_enabled": True, "buy_free_storage_days": 20,
        "buy_specs": buy_specs,
    }
    r = requests.post(f"{API}/swaps", json=swap_body,
                      headers={"Authorization": f"Bearer {t1}"}, verify=False)
    assert r.status_code == 200, f"建换盘失败: {r.status_code} {r.text[:300]}"
    sj = r.json()
    swid = (sj.get("swap") or sj.get("data") or sj).get("id")
    assert swid, f"换盘 id 提取失败: {json.dumps(sj, ensure_ascii=False)[:200]}"
    print(f"  换盘 {swid}: 卖腿 dp={sell_dp} pm={sell_pm} | 买腿 dp={buy_dp} pm={buy_pm}")

    # u2 对卖腿还盘，仅协商 交割期 + 付款方式 + 规格（不协商 交割地/交割方式/免仓）
    off_swap_dp, off_swap_pm, off_swap_specs = "2026-12", "账期结算", {"grade": "食品级"}
    r = create_counter(t2, "swap", swid, 9999998, 50, mode="sell",
                       offer_delivery_period=off_swap_dp,
                       offer_payment_method=off_swap_pm,
                       offer_specs=json.dumps(off_swap_specs))
    assert r.status_code == 200, f"换盘发起议价失败: {r.status_code} {r.text[:400]}"
    sco = r.json().get("data") or r.json()
    scoid = sco["id"]
    print(f"  换盘议价 {scoid}: 仅协商 dp={off_swap_dp} pm={off_swap_pm} specs={off_swap_specs}")

    r = accept_counter(t1, scoid)
    assert r.status_code == 200, f"换盘接受失败: {r.status_code} {r.text[:400]}"
    print("  已接受")

    tr = find_trade(trades_mine(t1, pid), sell_order_id=swid)
    assert tr, f"未找到换盘成交记录(换盘 {swid})。样本: {json.dumps(trades_mine(t1, pid)[:2], ensure_ascii=False)[:400]}"
    print(f"  换盘成交: dp={tr.get('delivery_period')} dl={tr.get('delivery_location')} "
          f"dm={tr.get('delivery_method')} fse={tr.get('free_storage_enabled')} fsd={tr.get('free_storage_days')} "
          f"buy_pm={tr.get('buy_payment_method')} sell_pm={tr.get('sell_payment_method')}")
    print(f"  buy_specs={json.dumps(tr.get('buy_specs'), ensure_ascii=False)} "
          f"sell_specs={json.dumps(tr.get('sell_specs'), ensure_ascii=False)}")

    # mode=sell → 回退取卖腿原条款（交割地/交割方式/免仓应为卖腿原值）
    if tr.get("delivery_period") != off_swap_dp:
        problems.append(f"[swap] delivery_period 期望 {off_swap_dp} 实际 {tr.get('delivery_period')}")
    if tr.get("delivery_location") != sell_dl:
        problems.append(f"[swap] delivery_location 回退期望卖腿 {sell_dl} 实际 {tr.get('delivery_location')}")
    if tr.get("delivery_method") != sell_dm:
        problems.append(f"[swap] delivery_method 回退期望卖腿 {sell_dm} 实际 {tr.get('delivery_method')}")
    if tr.get("free_storage_enabled") is not True:
        problems.append(f"[swap] free_storage_enabled 回退期望 True 实际 {tr.get('free_storage_enabled')}")
    if tr.get("free_storage_days") != 30:
        problems.append(f"[swap] free_storage_days 回退期望卖腿 30 实际 {tr.get('free_storage_days')}")
    if tr.get("buy_payment_method") != off_swap_pm:
        problems.append(f"[swap] buy_payment_method 期望 {off_swap_pm} 实际 {tr.get('buy_payment_method')}")
    if tr.get("sell_payment_method") != sell_pm:
        problems.append(f"[swap] sell_payment_method 回退期望卖腿 {sell_pm} 实际 {tr.get('sell_payment_method')}")
    if norm_specs(tr.get("buy_specs")) != off_swap_specs:
        problems.append(f"[swap] buy_specs 期望 {off_swap_specs} 实际 {tr.get('buy_specs')}")
    if norm_specs(tr.get("sell_specs")) != sell_specs:
        problems.append(f"[swap] sell_specs 回退期望卖腿 {sell_specs} 实际 {tr.get('sell_specs')}")

    section("3. 结论")
    if problems:
        print("❌ 发现问题:")
        for p in problems:
            print("   -", p)
        sys.exit(1)
    print("✅ 全部通过：列表路径覆盖 + 换盘路径覆盖/回退 均正确，迁移024生效。")


if __name__ == "__main__":
    main()
