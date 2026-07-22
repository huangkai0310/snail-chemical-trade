#!/usr/bin/env python3
import paramiko
import json

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

# Use python on server for utf8 json dump
py = r'''
import os, json, psycopg2
url = open("/opt/snailtrade/.env").read().split("DATABASE_URL=",1)[1].split("\n",1)[0].strip().strip('"').strip("'")
# convert postgres URL for psycopg2
u = url.replace("postgres://","postgresql://")
conn = psycopg2.connect(u)
cur = conn.cursor()

cur.execute("""
SELECT serial_no, side, product_id, price, quantity, filled, status,
       delivery_period, delivery_location, delivery_method, payment_method,
       free_storage_enabled, free_storage_days, user_id::text, specs
FROM listings WHERE serial_no = 17408
""")
cols = [d[0] for d in cur.description]
rows = cur.fetchall()
print("=== L017408 ===")
for r in rows:
    print(json.dumps(dict(zip(cols, r)), ensure_ascii=False, default=str, indent=2))

cur.execute("""
SELECT serial_no, status, user_id::text,
       sell_product_id, sell_price, sell_quantity, sell_filled,
       sell_delivery_period, sell_delivery_location, sell_delivery_method, sell_payment_method,
       sell_free_storage_enabled, sell_free_storage_days, sell_specs,
       buy_product_id, buy_price, buy_quantity, buy_filled,
       buy_delivery_period, buy_delivery_location, buy_delivery_method, buy_payment_method,
       buy_free_storage_enabled, buy_free_storage_days, buy_specs
FROM swap_listings WHERE serial_no = 57
""")
cols = [d[0] for d in cur.description]
rows = cur.fetchall()
print("=== S000057 ===")
for r in rows:
    print(json.dumps(dict(zip(cols, r)), ensure_ascii=False, default=str, indent=2))

cur.execute("""
SELECT id::text, match_side, matched_qty, lock_status, acceptor_id::text, matched_at
FROM swap_matches WHERE swap_a_id = (SELECT id FROM swap_listings WHERE serial_no=57)
ORDER BY matched_at
""")
cols = [d[0] for d in cur.description]
print("=== matches on S000057 ===")
for r in cur.fetchall():
    print(json.dumps(dict(zip(cols, r)), ensure_ascii=False, default=str))

# compare buy leg of swap vs sell listing for #697-6 eligibility
print("=== field compare (listing SELL vs swap BUY leg) ===")
'''

sftp = ssh.open_sftp()
with sftp.file("/tmp/dump_ls.py", "w") as f:
    f.write(py)
sftp.close()

# check if psycopg2 available else use jsonb from psql
out = run("python3 /tmp/dump_ls.py 2>&1")
if "No module named" in out or "ModuleNotFoundError" in out:
    sql = r"""
COPY (
  SELECT json_build_object(
    'kind','listing',
    'serial_no', serial_no, 'side', side, 'product_id', product_id,
    'price', price, 'qty', quantity, 'filled', filled, 'status', status,
    'dp', delivery_period, 'loc', delivery_location, 'dm', delivery_method,
    'pm', payment_method, 'fs', free_storage_enabled, 'fsd', free_storage_days,
    'user', user_id::text, 'specs', specs
  ) FROM listings WHERE serial_no=17408
) TO STDOUT;
COPY (
  SELECT json_build_object(
    'kind','swap',
    'serial_no', serial_no, 'status', status, 'user', user_id::text,
    'sell_p', sell_product_id, 'sell_px', sell_price, 'sell_qty', sell_quantity, 'sell_filled', sell_filled,
    'sell_dp', sell_delivery_period, 'sell_loc', sell_delivery_location, 'sell_dm', sell_delivery_method,
    'sell_pm', sell_payment_method, 'sell_fs', sell_free_storage_enabled, 'sell_fsd', sell_free_storage_days,
    'buy_p', buy_product_id, 'buy_px', buy_price, 'buy_qty', buy_quantity, 'buy_filled', buy_filled,
    'buy_dp', buy_delivery_period, 'buy_loc', buy_delivery_location, 'buy_dm', buy_delivery_method,
    'buy_pm', buy_payment_method, 'buy_fs', buy_free_storage_enabled, 'buy_fsd', buy_free_storage_days
  ) FROM swap_listings WHERE serial_no=57
) TO STDOUT;
COPY (
  SELECT json_build_object(
    'id', id::text, 'side', match_side, 'qty', matched_qty, 'lock', lock_status,
    'acceptor', acceptor_id::text, 'at', matched_at
  ) FROM swap_matches WHERE swap_a_id=(SELECT id FROM swap_listings WHERE serial_no=57)
  ORDER BY matched_at
) TO STDOUT;
"""
    sftp = ssh.open_sftp()
    with sftp.file("/tmp/dump_ls.sql", "w") as f:
        f.write(sql)
    sftp.close()
    print(run(f"psql '{url}' -f /tmp/dump_ls.sql 2>&1"))
else:
    print(out)
ssh.close()
