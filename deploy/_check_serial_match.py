#!/usr/bin/env python3
"""Check why L017408 and S000057 did not match."""
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
\echo === find by serial ===
SELECT id, serial_no, side, product_id, price, quantity, filled, status,
       delivery_period, delivery_location, delivery_method, payment_method,
       free_storage_enabled, free_storage_days, user_id, created_at, updated_at,
       allow_partial, min_quantity
FROM listings
WHERE serial_no IN (17408, 57)
   OR serial_no::text LIKE '%17408%'
   OR serial_no::text LIKE '%000057%'
ORDER BY serial_no;

\echo === also search padded display? ===
-- serial display might be L017408 = listing buy?, S000057 = sell
SELECT id, serial_no, side, product_id, price::text, quantity::text, filled::text, status,
       delivery_period, delivery_location, delivery_method, payment_method,
       free_storage_enabled, free_storage_days,
       user_id, allow_partial, min_quantity, created_at
FROM listings
WHERE serial_no IN (17408, 57)
ORDER BY side, serial_no;

\echo === recent OPEN/PARTIAL same product near those ===
SELECT serial_no, side, product_id, price::text, quantity::text, filled::text, status,
       delivery_period, delivery_location, delivery_method, payment_method,
       free_storage_enabled, free_storage_days, user_id
FROM listings
WHERE status IN ('OPEN','PARTIAL')
  AND product_id IN (
    SELECT product_id FROM listings WHERE serial_no IN (17408, 57)
  )
ORDER BY product_id, side, price;
"""

sftp = ssh.open_sftp()
with sftp.file("/tmp/check_match_serial.sql", "w") as f:
    f.write(sql)
sftp.close()
print(run(f"psql '{url}' -f /tmp/check_match_serial.sql 2>&1"))
ssh.close()
