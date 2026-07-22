# -*- coding: utf-8 -*-
import paramiko

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
DB = "postgresql://snailtrade:snailtrade2024@127.0.0.1:5432/snailtrade"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

def run(sql):
    cmd = f"psql '{DB}' -c \"{sql}\""
    _, stdout, stderr = ssh.exec_command(cmd, timeout=60)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    return out + err

print("=== L017409 / L017410 ===")
print(run("""
SELECT serial_no, id::text, user_id::text, product_id, side, price, quantity, filled, status,
       COALESCE(delivery_period,'(null)') AS dp,
       COALESCE(delivery_location,'(null)') AS dl,
       COALESCE(delivery_method,'(null)') AS dm,
       COALESCE(payment_method,'(null)') AS pm,
       free_storage_enabled, free_storage_days,
       COALESCE(specs::text,'(null)') AS specs,
       allow_partial, min_quantity, created_at
FROM listings WHERE serial_no IN (17409, 17410) ORDER BY serial_no;
"""))

print("=== side-by-side compare ===")
print(run("""
SELECT a.serial_no AS a, b.serial_no AS b,
       a.side AS a_side, b.side AS b_side,
       a.user_id = b.user_id AS same_user,
       a.product_id = b.product_id AS same_product,
       a.price AS a_price, b.price AS b_price,
       a.quantity AS a_qty, b.quantity AS b_qty,
       a.filled AS a_filled, b.filled AS b_filled,
       a.status AS a_status, b.status AS b_status,
       COALESCE(a.delivery_period,'') AS a_dp, COALESCE(b.delivery_period,'') AS b_dp,
       COALESCE(a.delivery_period,'') IS NOT DISTINCT FROM COALESCE(b.delivery_period,'') AS dp_eq,
       COALESCE(a.delivery_method,'') AS a_dm, COALESCE(b.delivery_method,'') AS b_dm,
       COALESCE(a.delivery_method,'') IS NOT DISTINCT FROM COALESCE(b.delivery_method,'') AS dm_eq,
       a.free_storage_enabled AS a_fs, b.free_storage_enabled AS b_fs,
       a.free_storage_enabled IS NOT DISTINCT FROM b.free_storage_enabled AS fs_eq,
       COALESCE(a.free_storage_days,0) AS a_fsd, COALESCE(b.free_storage_days,0) AS b_fsd,
       COALESCE(a.free_storage_days,0) IS NOT DISTINCT FROM COALESCE(b.free_storage_days,0) AS fsd_eq,
       COALESCE(a.delivery_location,'') AS a_dl, COALESCE(b.delivery_location,'') AS b_dl,
       COALESCE(a.payment_method,'') AS a_pm, COALESCE(b.payment_method,'') AS b_pm
FROM listings a, listings b
WHERE a.serial_no = 17409 AND b.serial_no = 17410;
"""))

print("=== blacklist between them ===")
print(run("""
SELECT * FROM user_blacklist
WHERE (user_id, blocked_user_id) IN (
  SELECT a.user_id, b.user_id FROM listings a, listings b WHERE a.serial_no=17409 AND b.serial_no=17410
  UNION
  SELECT b.user_id, a.user_id FROM listings a, listings b WHERE a.serial_no=17409 AND b.serial_no=17410
);
"""))

print("=== recent trades involving either ===")
print(run("""
SELECT t.id::text, t.price, t.quantity, t.source, t.traded_at,
       t.buy_serial_no, t.sell_serial_no
FROM trades t
WHERE t.buy_serial_no IN (17409,17410) OR t.sell_serial_no IN (17409,17410)
ORDER BY traded_at DESC LIMIT 10;
"""))

ssh.close()
