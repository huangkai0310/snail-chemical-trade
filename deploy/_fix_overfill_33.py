#!/usr/bin/env python3
"""Rollback over-match: L017408/S000057 should be 33t paired, not 100t."""
import paramiko

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)


def run(cmd: str) -> str:
    _, o, e = ssh.exec_command(cmd, timeout=120)
    return (o.read() + e.read()).decode("utf-8", errors="replace")


env = run("grep DATABASE_URL /opt/snailtrade/.env")
url = env.strip().split("=", 1)[1].strip().strip('"').strip("'")

sql = r"""
BEGIN;

UPDATE listings
SET filled = 33, status = 'OPEN', updated_at = NOW()
WHERE serial_no = 17408 AND filled >= 100;

UPDATE swap_listings
SET buy_filled = 33, status = 'OPEN', updated_at = NOW()
WHERE serial_no = 57 AND buy_filled >= 100;

UPDATE swap_matches
SET matched_qty = 33
WHERE id = 'd8497890-28e0-44b3-8feb-fc380977a398' AND matched_qty >= 100;

UPDATE swap_matches
SET lock_status = 'FLASHED'
WHERE id = '1194c028-6b12-4d4b-ab47-765ffddd04bd' AND lock_status = 'ACTIVE';

UPDATE trades
SET quantity = 33
WHERE id = '2933516a-51ef-4faa-b38e-14a1583f83ef' AND quantity >= 100;

INSERT INTO trades (
  product_id, buy_order_id, sell_order_id, buy_user_id, sell_user_id,
  price, quantity, delivery_period, delivery_location,
  buy_serial_no, sell_serial_no, buy_payment_method, sell_payment_method,
  delivery_method, free_storage_enabled, free_storage_days,
  buy_specs, sell_specs, source, aggressor_user_id
)
SELECT
  sl.sell_product_id,
  '1194c028-6b12-4d4b-ab47-765ffddd04bd'::uuid,
  sl.id,
  'b426b42f-2c2c-4a03-8126-47d0e4b1893f'::uuid,
  sl.user_id,
  sl.sell_price,
  33,
  sl.sell_delivery_period,
  sl.sell_delivery_location,
  sl.serial_no,
  sl.serial_no,
  sl.sell_payment_method,
  sl.sell_payment_method,
  sl.sell_delivery_method,
  sl.sell_free_storage_enabled,
  sl.sell_free_storage_days,
  sl.sell_specs,
  sl.sell_specs,
  'swap',
  'b426b42f-2c2c-4a03-8126-47d0e4b1893f'::uuid
FROM swap_listings sl
WHERE sl.serial_no = 57
  AND NOT EXISTS (
    SELECT 1 FROM trades t
    WHERE t.buy_order_id = '1194c028-6b12-4d4b-ab47-765ffddd04bd'
      AND abs(t.quantity - 33) < 0.01
  );

COMMIT;

\echo === after fix ===
COPY (SELECT json_build_object(
  'listing_filled', filled, 'listing_status', status, 'qty', quantity
) FROM listings WHERE serial_no=17408) TO STDOUT;
COPY (SELECT json_build_object(
  'sell_f', sell_filled, 'buy_f', buy_filled, 'status', status
) FROM swap_listings WHERE serial_no=57) TO STDOUT;
COPY (SELECT json_build_object(
  'side', match_side, 'qty', matched_qty, 'lock', lock_status
) FROM swap_matches WHERE swap_a_id=(SELECT id FROM swap_listings WHERE serial_no=57)
ORDER BY matched_at) TO STDOUT;
COPY (SELECT json_build_object(
  'price', price, 'qty', quantity, 'source', source
) FROM trades WHERE sell_order_id=(SELECT id FROM swap_listings WHERE serial_no=57)
ORDER BY traded_at) TO STDOUT;
"""

sftp = ssh.open_sftp()
with sftp.file("/tmp/fix_overfill2.sql", "w") as f:
    f.write(sql)
sftp.close()
print(run(f"psql '{url}' -v ON_ERROR_STOP=1 -f /tmp/fix_overfill2.sql 2>&1"))
ssh.close()
