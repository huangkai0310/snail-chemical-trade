# -*- coding: utf-8 -*-
import paramiko, sys, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
time.sleep(3)

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

print(run("""
SELECT serial_no, side, price, quantity, filled, status, updated_at
FROM listings WHERE serial_no IN (17409, 17410) ORDER BY serial_no;
"""))
print(run("""
SELECT id::text, price, quantity, source, buy_serial_no, sell_serial_no, traded_at
FROM trades
WHERE buy_serial_no IN (17409,17410) OR sell_serial_no IN (17409,17410)
ORDER BY traded_at DESC LIMIT 5;
"""))
_, stdout, _ = ssh.exec_command("journalctl -u snail-api --since '2026-07-17 14:30:00' --no-pager 2>&1 | grep -E '重撮|Rematch|17409|reconcile' | head -20", timeout=30)
print("--- logs ---")
print(stdout.read().decode("utf-8", errors="replace"))
ssh.close()
