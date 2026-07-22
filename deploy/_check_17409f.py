# -*- coding: utf-8 -*-
import paramiko, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("115.159.64.125", port=22, username="root", password="Kai&19920310", timeout=30)
DB = "postgresql://snailtrade:snailtrade2024@127.0.0.1:5432/snailtrade"

sql = """
SELECT action, order_id, product_id, side, price, quantity, user_id, timestamp
FROM engine_wal
WHERE order_id IN (
  'e9030f75-56a5-4d92-bece-6ebcc1470638',
  'ee854a98-73b6-4f17-816b-de1ff9b24ec1'
)
OR (timestamp BETWEEN '2026-07-17 14:19:40+08' AND '2026-07-17 14:21:10+08' AND product_id='acetone')
ORDER BY timestamp;
"""
sftp = ssh.open_sftp()
with sftp.file("/tmp/_q.sql", "w") as f:
    f.write(sql)
sftp.close()
_, stdout, stderr = ssh.exec_command(f"psql '{DB}' -f /tmp/_q.sql", timeout=60)
print(stdout.read().decode("utf-8", errors="replace"))
print(stderr.read().decode("utf-8", errors="replace"))
ssh.close()
