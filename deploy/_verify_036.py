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
\echo === migration 036 ===
SELECT * FROM schema_migrations WHERE filename LIKE '%036%';

\echo === swap sources after fix ===
SELECT id, price::text, quantity::text, source, traded_at
FROM trades
WHERE sell_order_id = 'a03a1a6d-6a66-44e1-a23d-f0841cbc7d8f'
ORDER BY traded_at DESC;

\echo === acetone latest (excluding private) ===
SELECT price, source, traded_at FROM trades
WHERE product_id='acetone' AND source IS DISTINCT FROM 'swap_private'
ORDER BY traded_at DESC LIMIT 5;
"""

sftp = ssh.open_sftp()
with sftp.file("/tmp/verify036.sql", "w") as f:
    f.write(sql)
sftp.close()
print(run(f"psql '{url}' -f /tmp/verify036.sql 2>&1"))
print("--- journal ---")
print(run("journalctl -u snail-api --since '2 min ago' --no-pager 2>&1 | grep -i migrat | tail -20"))
ssh.close()
