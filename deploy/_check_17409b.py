# -*- coding: utf-8 -*-
import paramiko, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("115.159.64.125", port=22, username="root", password="Kai&19920310", timeout=30)
DB = "postgresql://snailtrade:snailtrade2024@127.0.0.1:5432/snailtrade"

def run(sql):
    # write sql to temp file to avoid escaping issues
    sftp = ssh.open_sftp()
    with sftp.file("/tmp/_q.sql", "w") as f:
        f.write(sql)
    sftp.close()
    _, stdout, stderr = ssh.exec_command(f"psql '{DB}' -f /tmp/_q.sql", timeout=60)
    return stdout.read().decode("utf-8", errors="replace") + stderr.read().decode("utf-8", errors="replace")

print(run("""
\\encoding UTF8
SELECT serial_no, side, price, quantity, filled, status,
       delivery_period, delivery_method, payment_method, delivery_location,
       free_storage_enabled, free_storage_days, specs::text,
       allow_partial, min_quantity, user_id::text, created_at
FROM listings WHERE serial_no IN (17409, 17410) ORDER BY serial_no;
"""))

# Check hex of delivery_period and delivery_method for exact bytes
print("--- hex compare ---")
print(run("""
SELECT serial_no,
       encode(convert_to(COALESCE(delivery_period,''), 'UTF8'), 'hex') AS dp_hex,
       encode(convert_to(COALESCE(delivery_method,''), 'UTF8'), 'hex') AS dm_hex,
       encode(convert_to(COALESCE(delivery_location,''), 'UTF8'), 'hex') AS dl_hex,
       encode(convert_to(COALESCE(payment_method,''), 'UTF8'), 'hex') AS pm_hex
FROM listings WHERE serial_no IN (17409, 17410) ORDER BY serial_no;
"""))

# Check API orderbook for acetone spot
print("--- service logs around create ---")
_, stdout, _ = ssh.exec_command("journalctl -u snail-api --since '2026-07-17 14:19:00' --until '2026-07-17 14:21:00' --no-pager 2>&1 | tail -80", timeout=30)
print(stdout.read().decode("utf-8", errors="replace"))

ssh.close()
