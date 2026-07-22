"""#539 逻辑校验：用 CTE 构造 swap_listings + counter_offers，验证 ref_* 的 COALESCE
按 co.mode 选取正确腿（buy→买腿，sell/both→卖腿），且与 acceptSwapCounterOffer 一致。
全程只读，不写入任何真实表。
"""
import paramiko

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
DB = "postgres://snailtrade:snailtrade2024@127.0.0.1:5432/snailtrade?sslmode=disable"

# 构造：卖腿 price=100/product=S1，买腿 price=200/product=S2
CTE = """
WITH swap_listings(sell_price, buy_price, sell_product_id, buy_product_id) AS (
  VALUES (100.0, 200.0, 'S1', 'S2')
),
counter_offers(id, mode, ref_id, ref_type) AS (
  VALUES ('co_buy',  'buy',  'x', 'swap'),
         ('co_sell', 'sell', 'x', 'swap'),
         ('co_both', 'both', 'x', 'swap')
)
SELECT
  co.id,
  co.mode,
  COALESCE(NULL, CASE co.mode WHEN 'buy' THEN s.buy_price ELSE s.sell_price END) AS ref_price,
  COALESCE(NULL, CASE co.mode WHEN 'buy' THEN s.buy_product_id ELSE s.sell_product_id END) AS product_id
FROM counter_offers co
CROSS JOIN swap_listings s
WHERE co.ref_type = 'swap'
ORDER BY co.id;
"""


def run(ssh, cmd, timeout=30):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return stdout.read().decode("utf-8", "replace"), stderr.read().decode("utf-8", "replace")


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

    out, err = run(ssh, f'psql "{DB}" -t -c "{CTE.replace(chr(10), " ")}"', timeout=30)
    ssh.close()

    if err.strip():
        print("[FAIL] psql 报错:", err.strip()[:500])
        return 1

    print("原始输出:")
    print(out.strip())
    # 解析 "id | mode | ref_price | product_id"
    rows = {}
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split("|")]
        if len(parts) == 4:
            rows[parts[0]] = (parts[1], parts[2], parts[3])

    expect = {
        "co_buy":  ("buy",  "200.0", "S2"),   # buy→买腿
        "co_sell": ("sell", "100.0", "S1"),   # sell→卖腿
        "co_both": ("both", "100.0", "S1"),   # both→卖腿（与成交一致）
    }
    ok = True
    for cid, (mode, price, pid) in expect.items():
        got = rows.get(cid)
        passv = got and got[1] == price and got[2] == pid
        print(f"  [{'PASS' if passv else 'FAIL'}] {cid}: 期望 price={price} product={pid} | 实际 {got}")
        ok = ok and passv

    print("\n结论:", "ALL PASS" if ok else "SOME FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
