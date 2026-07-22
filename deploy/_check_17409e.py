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

print(run("\\d engine_wal"))
print(run("""
SELECT * FROM engine_wal
WHERE created_at BETWEEN '2026-07-17 14:19:40' AND '2026-07-17 14:21:10'
   OR order_id IN (
     'e9030f75-56a5-4d92-bece-6ebcc1470638',
     'ee854a98-73b6-4f17-816b-de1ff9b24ec1'
   )
ORDER BY created_at
LIMIT 100;
"""))

ssh.close()
