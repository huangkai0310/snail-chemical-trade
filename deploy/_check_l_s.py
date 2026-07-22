#!/usr/bin/env python3
"""Check L017408 (listing) vs S000057 (swap) mismatch."""
import json
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
SET client_encoding TO 'UTF8';

\echo === L017408 listing ===
SELECT id, serial_no, side, product_id, price::text, quantity::text, filled::text, status,
       delivery_period, delivery_location, delivery_method, payment_method,
       free_storage_enabled, free_storage_days, user_id, allow_partial, min_quantity,
       specs::text
FROM listings WHERE serial_no = 17408;

\echo === S000057 swap ===
SELECT id, serial_no, user_id, status,
       sell_product_id, sell_price::text, sell_quantity::text, sell_filled::text,
       sell_delivery_period, sell_delivery_location, sell_delivery_method, sell_payment_method,
       sell_free_storage_enabled, sell_free_storage_days, sell_allow_partial, sell_min_quantity,
       buy_product_id, buy_price::text, buy_quantity::text, buy_filled::text,
       buy_delivery_period, buy_delivery_location, buy_delivery_method, buy_payment_method,
       buy_free_storage_enabled, buy_free_storage_days, buy_allow_partial, buy_min_quantity,
       sell_specs::text, buy_specs::text
FROM swap_listings WHERE serial_no = 57;

\echo === any swap serial 57 history ===
SELECT id, serial_no, status, matched_at FROM swap_listings WHERE serial_no = 57;
"""

# Fix last query - swap_listings may not have matched_at
sql = r"""
SET client_encoding TO 'UTF8';

\echo === L017408 listing ===
SELECT id, serial_no, side, product_id, price::text, quantity::text, filled::text, status,
       delivery_period, delivery_location, COALESCE(delivery_method,'(null)') AS delivery_method,
       COALESCE(payment_method,'(null)') AS payment_method,
       free_storage_enabled, free_storage_days, user_id::text, allow_partial, min_quantity::text
FROM listings WHERE serial_no = 17408;

\echo === S000057 swap ===
SELECT id, serial_no, user_id::text, status,
       sell_product_id, sell_price::text, sell_quantity::text, sell_filled::text,
       sell_delivery_period, sell_delivery_location,
       COALESCE(sell_delivery_method,'(null)') AS sell_dm,
       COALESCE(sell_payment_method,'(null)') AS sell_pm,
       sell_free_storage_enabled, sell_free_storage_days,
       buy_product_id, buy_price::text, buy_quantity::text, buy_filled::text,
       buy_delivery_period, buy_delivery_location,
       COALESCE(buy_delivery_method,'(null)') AS buy_dm,
       COALESCE(buy_payment_method,'(null)') AS buy_pm,
       buy_free_storage_enabled, buy_free_storage_days
FROM swap_listings WHERE serial_no = 57;

\echo === columns swap ===
SELECT column_name FROM information_schema.columns WHERE table_name='swap_listings' AND column_name LIKE '%spec%' OR (table_name='swap_listings' AND column_name LIKE '%allow%') OR (table_name='swap_listings' AND column_name LIKE '%min%') ORDER BY 1;
"""

sftp = ssh.open_sftp()
with sftp.file("/tmp/check_ls.sql", "w") as f:
    f.write(sql)
sftp.close()
print(run(f"psql '{url}' -v ON_ERROR_STOP=0 -f /tmp/check_ls.sql 2>&1"))
ssh.close()
