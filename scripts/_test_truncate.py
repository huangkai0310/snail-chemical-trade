import paramiko

HOST = "115.159.64.125"
SSH_USER = "root"
SSH_PASSWORD = "Kai&19920310"
DB_USER = "snailtrade"
DB_PASS = "snailtrade2024"
DB_NAME = "snailtrade"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=SSH_USER, password=SSH_PASSWORD, timeout=30)

# 先执行 BEGIN + TRUNCATE，看看报什么错
test_sql = """
BEGIN;
TRUNCATE TABLE engine_wal RESTART IDENTITY CASCADE;
TRUNCATE TABLE swap_matches RESTART IDENTITY CASCADE;
TRUNCATE TABLE swap_listings RESTART IDENTITY CASCADE;
TRUNCATE TABLE margin_holds RESTART IDENTITY CASCADE;
TRUNCATE TABLE trades RESTART IDENTITY CASCADE;
TRUNCATE TABLE listings RESTART IDENTITY CASCADE;
TRUNCATE TABLE transactions RESTART IDENTITY CASCADE;
TRUNCATE TABLE accounts RESTART IDENTITY CASCADE;
DELETE FROM users WHERE username <> 'admin';
SELECT 'users' AS t, COUNT(*) FROM users;
SELECT 'listings' AS t, COUNT(*) FROM listings;
SELECT 'trades' AS t, COUNT(*) FROM trades;
ROLLBACK;
"""

import os
sql_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_test_truncate.sql")
with open(sql_path, "w", encoding="utf-8") as f:
    f.write(test_sql)

sftp = ssh.open_sftp()
sftp.put(sql_path, "/tmp/_test_truncate.sql")
sftp.close()

cmd = f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} -f /tmp/_test_truncate.sql 2>&1"
_, stdout, stderr = ssh.exec_command(cmd, timeout=60)
out = stdout.read().decode()
err = stderr.read().decode()
print("=== STDOUT ===")
print(out)
if err:
    print("=== STDERR ===")
    print(err[:1000])

ssh.close()
