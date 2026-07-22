#!/usr/bin/env python3
import paramiko

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)


def run(cmd: str) -> str:
    _, o, e = ssh.exec_command(cmd, timeout=90)
    return (o.read() + e.read()).decode("utf-8", errors="replace")


env = run("grep DATABASE_URL /opt/snailtrade/.env")
url = env.strip().split("=", 1)[1].strip().strip('"').strip("'")

sql = r"""
COPY (
 SELECT json_build_object(
   'listing_serial', serial_no, 'status', status, 'filled', filled, 'qty', quantity, 'price', price
 ) FROM listings WHERE serial_no=17408
) TO STDOUT;
COPY (
 SELECT json_build_object(
   'swap_serial', serial_no, 'status', status,
   'buy_filled', buy_filled, 'buy_qty', buy_quantity,
   'sell_filled', sell_filled, 'sell_qty', sell_quantity
 ) FROM swap_listings WHERE serial_no=57
) TO STDOUT;
COPY (
 SELECT json_build_object(
   'trade_id', id::text, 'price', price, 'qty', quantity, 'source', source, 'at', traded_at
 ) FROM trades
 WHERE sell_order_id = (SELECT id FROM swap_listings WHERE serial_no=57)
    OR buy_order_id = (SELECT id FROM listings WHERE serial_no=17408)
 ORDER BY traded_at DESC LIMIT 5
) TO STDOUT;
"""
sftp = ssh.open_sftp()
with sftp.file("/tmp/v_cross.sql", "w") as f:
    f.write(sql)
sftp.close()
print(run(f"psql '{url}' -f /tmp/v_cross.sql 2>&1"))
print("--- logs ---")
print(run("journalctl -u snail-api --since '2 min ago' --no-pager 2>&1 | grep -E '697-6b|Reconcile|自动撮合' | tail -20"))
ssh.close()
