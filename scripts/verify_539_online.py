"""#542 在线校验：部署后核对前端字眼 + 后端换盘 ref_* 查询 SQL 合法性。

- 前端：curl 线上 counter-offers.html，确认含「品种」「时间」，且不含「买腿/卖腿/双腿」。
- 后端：psql 跑一遍 counter_offer.go 中换盘 ref_* 的 COALESCE 查询（LIMIT 0），
  确认 SQL 解析无误、不会因列不匹配 500。
"""
import paramiko

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
DB = "postgres://snailtrade:snailtrade2024@127.0.0.1:5432/snailtrade?sslmode=disable"

SWAP_QUERY = """
SELECT
  co.id,
  COALESCE(l.price, CASE co.mode WHEN 'buy' THEN s.buy_price ELSE s.sell_price END) AS ref_price,
  COALESCE(l.quantity, CASE co.mode WHEN 'buy' THEN s.buy_quantity ELSE s.sell_quantity END) AS ref_quantity,
  COALESCE(l.filled, CASE co.mode WHEN 'buy' THEN s.buy_filled ELSE s.sell_filled END) AS ref_filled,
  COALESCE(l.delivery_period, CASE co.mode WHEN 'buy' THEN s.buy_delivery_period ELSE s.sell_delivery_period END) AS ref_delivery_period,
  COALESCE(l.delivery_location, CASE co.mode WHEN 'buy' THEN s.buy_delivery_location ELSE s.sell_delivery_location END) AS ref_delivery_location,
  COALESCE(l.payment_method, CASE co.mode WHEN 'buy' THEN s.buy_payment_method ELSE s.sell_payment_method END) AS ref_payment_method,
  COALESCE(l.delivery_method, CASE co.mode WHEN 'buy' THEN s.buy_delivery_method ELSE s.sell_delivery_method END) AS ref_delivery_method,
  COALESCE(l.free_storage_enabled, CASE co.mode WHEN 'buy' THEN s.buy_free_storage_enabled ELSE s.sell_free_storage_enabled END) AS ref_free_storage_enabled,
  COALESCE(l.free_storage_days, CASE co.mode WHEN 'buy' THEN s.buy_free_storage_days ELSE s.sell_free_storage_days END) AS ref_free_storage_days,
  COALESCE(l.specs::text, CASE co.mode WHEN 'buy' THEN s.buy_specs::text ELSE s.sell_specs::text END) AS ref_specs,
  COALESCE(l.product_id, CASE co.mode WHEN 'buy' THEN s.buy_product_id ELSE s.sell_product_id END) AS product_id
FROM counter_offers co
LEFT JOIN listings l ON co.ref_id = l.id
LEFT JOIN swap_listings s ON co.ref_id = s.id
WHERE co.ref_type = 'swap'
LIMIT 0;
"""


def run(ssh, cmd, timeout=30):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    return out, err


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

    print("=== 前端字眼校验 ===")
    out, err = run(
        ssh,
        'curl -sk https://trade.snailchemical.com/counter-offers.html',
        timeout=30,
    )
    html = out
    checks = {
        "含「品种」": "品种" in html,
        "含「时间」列(表头)": "时间" in html,
        "不含「买腿」": "买腿" not in html,
        "不含「卖腿」": "卖腿" not in html,
        "不含「双腿」": "双腿" not in html,
        "含「换」(类型)": "换" in html,
    }
    ok = True
    for k, v in checks.items():
        print(f"  [{'PASS' if v else 'FAIL'}] {k}")
        ok = ok and v
    if err.strip():
        print("  curl stderr:", err.strip()[:200])

    print("\n=== 后端换盘 ref_* 查询 SQL 校验 ===")
    sql = SWAP_QUERY.replace("\n", " ")
    out, err = run(
        ssh,
        f'psql "{DB}" -t -c "{sql}"',
        timeout=30,
    )
    if err.strip():
        print("  [FAIL] psql 报错:")
        print("   ", err.strip()[:500])
        ok = False
    else:
        print("  [PASS] 查询解析无误（返回 0 行，无 SQL 错误）")
        print("   ", out.strip()[:200])

    ssh.close()
    print("\n=== 结论 ===")
    print("ALL PASS" if ok else "SOME FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
