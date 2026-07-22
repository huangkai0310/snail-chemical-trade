#!/usr/bin/env python3
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
\echo === all matches for swap a03a ===
SELECT id, acceptor_id, matched_qty, match_side, lock_status, matched_at
FROM swap_matches
WHERE swap_a_id = 'a03a1a6d-6a66-44e1-a23d-f0841cbc7d8f'
ORDER BY matched_at;

\echo === users ===
SELECT id, username FROM users WHERE id IN (
  '2c51eba3-c20d-4257-9f8a-6ac5ab853a65',
  'b426b42f-2c2c-4a03-8126-47d0e4b1893f'
);
"""

sftp = ssh.open_sftp()
with sftp.file("/tmp/check_match3.sql", "w") as f:
    f.write(sql)
sftp.close()
print(run(f"psql '{url}' -f /tmp/check_match3.sql 2>&1"))
ssh.close()
