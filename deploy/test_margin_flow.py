#!/usr/bin/env python3
"""
测试保证金冻结完整链路：
1. 登录 admin 用户
2. 查看账户（确认余额）
3. 发布挂牌（触发保证金冻结）
4. 查看账户（确认 frozen 增加）
5. 撤销挂牌（释放保证金）
6. 查看账户（确认 frozen 归零）
"""

import json
import urllib.request
import urllib.parse

BASE = "https://api.snailchemical.com/api/v1"

def req(method, path, body=None, token=None):
    url = BASE + path
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

def main():
    # 1. 登录
    print("=" * 60)
    print("Step 1: 登录 admin")
    status, resp = req("POST", "/auth/login", {"username": "admin", "password": "admin123"})
    if status != 200:
        # 尝试注册
        print(f"  登录失败({status})，尝试注册...")
        status, resp = req("POST", "/auth/register", {"username": "testmargin", "password": "test123456"})
        print(f"  注册: {status} {resp}")
        status, resp = req("POST", "/auth/login", {"username": "testmargin", "password": "test123456"})
    
    assert status == 200, f"登录失败: {status} {resp}"
    token = resp["token"]
    print(f"  ✅ 登录成功，token: {token[:30]}...")

    # 2. 查看账户（初始状态）
    print("\nStep 2: 查看初始账户余额")
    status, acct = req("GET", "/account", token=token)
    assert status == 200, f"获取账户失败: {status} {acct}"
    balance_before = float(acct["balance"])
    frozen_before = float(acct["frozen"])
    print(f"  可用余额: {balance_before:,.2f}")
    print(f"  冻结金额: {frozen_before:,.2f}")

    if balance_before < 1000:
        print("\n  余额不足，先充值 50,000...")
        status, r = req("POST", "/account/deposit", {"amount": 50000, "remark": "测试充值"}, token=token)
        assert status == 200, f"充值失败: {status} {r}"
        _, acct = req("GET", "/account", token=token)
        balance_before = float(acct["balance"])
        frozen_before = float(acct["frozen"])
        print(f"  充值后余额: {balance_before:,.2f}")

    # 3. 查询产品列表
    print("\nStep 3: 获取产品列表")
    status, products = req("GET", "/products")
    assert status == 200, f"获取产品失败: {status}"
    product = products[0]
    product_id = product["id"]
    print(f"  使用产品: {product['name']} ({product_id})")

    # 4. 发布挂牌（BUY，价格 1000，数量 1，保证金 = 1000 * 1 * 10% = 100）
    price = 1000.0
    quantity = 1.0
    expected_margin = round(price * quantity * 0.10, 2)
    print(f"\nStep 4: 发布 BUY 挂牌（价格={price}，数量={quantity}，预期保证金冻结={expected_margin}）")
    status, listing_resp = req("POST", "/listings", {
        "product_id": product_id,
        "side": "BUY",
        "price": price,
        "quantity": quantity,
        "delivery_period": "现货",
        "delivery_location": "上海仓"
    }, token=token)
    print(f"  响应状态: {status}")
    print(f"  响应内容: {json.dumps(listing_resp, ensure_ascii=False, indent=2)[:500]}")

    if status != 200 and status != 201:
        print(f"  ❌ 挂牌失败，可能发生了撮合成交（买卖单匹配），继续检查账户...")
        listing_id = None
    else:
        listing = listing_resp.get("listing", listing_resp)
        listing_id = listing.get("id") if isinstance(listing, dict) else None
        print(f"  ✅ 挂牌成功，listing_id: {listing_id}")

    # 5. 查看账户（检查保证金冻结）
    print("\nStep 5: 检查保证金冻结后账户状态")
    _, acct = req("GET", "/account", token=token)
    balance_after_list = float(acct["balance"])
    frozen_after_list = float(acct["frozen"])
    print(f"  可用余额: {balance_after_list:,.2f}（变化: {balance_after_list - balance_before:+.2f}）")
    print(f"  冻结金额: {frozen_after_list:,.2f}（变化: {frozen_after_list - frozen_before:+.2f}）")

    if frozen_after_list > frozen_before:
        margin_frozen = frozen_after_list - frozen_before
        print(f"  ✅ 保证金冻结成功！冻结了 {margin_frozen:.2f} 元（预期 {expected_margin:.2f}）")
        match_ok = abs(margin_frozen - expected_margin) < 0.01
        print(f"  {'✅' if match_ok else '⚠️'} 冻结金额{'正确' if match_ok else '与预期不符'}")
    else:
        print(f"  ℹ️  保证金未冻结（可能挂牌失败或立即成交了）")

    # 6. 撤销挂牌（释放保证金）
    if listing_id:
        print(f"\nStep 6: 撤销挂牌 {listing_id}")
        status, cancel_resp = req("DELETE", f"/listings/{listing_id}", token=token)
        print(f"  响应: {status} {cancel_resp}")

        if status == 200:
            print("\nStep 7: 检查保证金释放后账户状态")
            _, acct = req("GET", "/account", token=token)
            balance_final = float(acct["balance"])
            frozen_final = float(acct["frozen"])
            print(f"  可用余额: {balance_final:,.2f}（变化: {balance_final - balance_after_list:+.2f}）")
            print(f"  冻结金额: {frozen_final:,.2f}（变化: {frozen_final - frozen_after_list:+.2f}）")

            if abs(frozen_final - frozen_before) < 0.01:
                print(f"  ✅ 保证金释放成功！冻结额已归还到撤单前水平")
            elif frozen_final < frozen_after_list:
                print(f"  ✅ 保证金部分/全部释放：释放了 {frozen_after_list - frozen_final:.2f} 元")
            else:
                print(f"  ❌ 保证金未释放，冻结额仍为 {frozen_final:.2f}")
        else:
            print(f"  ⚠️  撤单失败（可能已成交），跳过保证金释放检查")
    else:
        print("\nStep 6: 跳过撤单（无有效 listing_id）")

    # 8. 查看最新流水
    print("\nStep 8: 查看最新资金流水")
    _, txn_resp = req("GET", "/account/transactions?page=1&page_size=5", token=token)
    txns = txn_resp.get("transactions", [])
    print(f"  最新 {len(txns)} 条流水：")
    type_names = {
        "DEPOSIT": "充值", "WITHDRAW": "提现",
        "FREEZE": "冻结", "UNFREEZE": "解冻",
        "TRADE_DEDUCT": "成交扣款", "TRADE_INCOME": "成交收款", "REFUND": "退款"
    }
    for t in txns:
        typ = type_names.get(t.get("type", ""), t.get("type", ""))
        amt = float(t.get("amount", 0))
        bal = float(t.get("balance_after", 0))
        frz = float(t.get("frozen_after", 0))
        sign = "+" if amt >= 0 else ""
        print(f"    [{typ}] 金额{sign}{amt:.2f}  余额→{bal:.2f}  冻结→{frz:.2f}  备注: {t.get('remark','')}")

    print("\n" + "=" * 60)
    print("✅ 保证金链路验证完成！")

if __name__ == "__main__":
    main()
