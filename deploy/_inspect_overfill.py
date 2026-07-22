#!/usr/bin/env python3
"""Inspect current L017408 / S000057 state after over-match."""
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
COPY (SELECT json_build_object(
  'serial', serial_no, 'status', status, 'filled', filled, 'qty', quantity, 'id', id::text
) FROM listings WHERE serial_no=17408) TO STDOUT;
COPY (SELECT json_build_object(
  'serial', serial_no, 'status', status,
  'sell_f', sell_filled, 'sell_q', sell_quantity,
  'buy_f', buy_filled, 'buy_q', buy_quantity, 'id', id::text
) FROM swap_listings WHERE serial_no=57) TO STDOUT;
COPY (SELECT json_build_object(
  'id', id::text, 'side', match_side, 'qty', matched_qty, 'lock', lock_status,
  'acceptor', acceptor_id::text, 'at', matched_at
) FROM swap_matches WHERE swap_a_id=(SELECT id FROM swap_listings WHERE serial_no=57)
ORDER BY matched_at) TO STDOUT;
COPY (SELECT json_build_object(
  'id', id::text, 'price', price, 'qty', quantity, 'source', source,
  'buy', buy_order_id::text, 'sell', sell_order_id::text, 'at', traded_at
) FROM trades WHERE sell_order_id=(SELECT id FROM swap_listings WHERE serial_no=57)
   OR buy_order_id=(SELECT id FROM listings WHERE serial_no=17408)
ORDER BY traded_at) TO STDOUT;
"""
sftp = ssh.open_sftp()
with sftp.file("/tmp/inspect_over.sql", "w") as f:
    f.write(sql)
sftp.close()
print(run(f"psql '{url}' -f /tmp/inspect_over.sql 2>&1"))
ssh.close()
