# -*- coding: utf-8 -*-
import paramiko, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("115.159.64.125", port=22, username="root", password="Kai&19920310", timeout=30)
DB = "postgresql://snailtrade:snailtrade2024@127.0.0.1:5432/snailtrade"

def run(sql):
    sftp = ssh.open_sftp()
    with sftp.file("/tmp/_q.sql", "w") as f:
        f.write(sql)
    sftp.close()
    _, stdout, stderr = ssh.exec_command(f"psql '{DB}' -f /tmp/_q.sql", timeout=60)
    return stdout.read().decode("utf-8", errors="replace") + stderr.read().decode("utf-8", errors="replace")

print("=== listing timestamps ===")
print(run("""
SELECT serial_no, created_at, updated_at, updated_at - created_at AS delta,
       delivery_period, delivery_method, allow_partial, min_quantity, price, quantity, filled, status
FROM listings WHERE serial_no IN (17409, 17410);
"""))

print("=== wal around that time if any ===")
print(run("""
SELECT * FROM order_wal
WHERE created_at BETWEEN '2026-07-17 14:19:40' AND '2026-07-17 14:21:10'
ORDER BY created_at
LIMIT 50;
"""))

print(run("""
\\dt *wal*
"""))

print(run("""
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%wal%';
"""))

ssh.close()
