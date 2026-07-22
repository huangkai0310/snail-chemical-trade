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
\echo === match 677c79f8 ===
SELECT * FROM swap_matches WHERE id = '677c79f8-6002-48c9-af0b-491fd76bfb41';

\echo === match 6e315e3e (private earlier) ===
SELECT * FROM swap_matches WHERE id = '6e315e3e-d141-4836-91f6-f4d5eb610df6';

\echo === swap listing a03a ===
SELECT id, user_id, sell_product_id, buy_product_id, sell_price, buy_price, sell_quantity, buy_quantity,
       sell_filled, buy_filled, status, serial_no
FROM swap_listings WHERE id = 'a03a1a6d-6a66-44e1-a23d-f0841cbc7d8f';

\echo === all matches for this swap ===
SELECT column_name FROM information_schema.columns WHERE table_name='swap_matches' ORDER BY ordinal_position;
"""

sftp = ssh.open_sftp()
with sftp.file("/tmp/check_match.sql", "w") as f:
    f.write(sql)
sftp.close()
print(run(f"psql '{url}' -f /tmp/check_match.sql 2>&1"))
ssh.close()
