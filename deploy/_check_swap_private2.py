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
\echo === trades cols ===
SELECT column_name FROM information_schema.columns WHERE table_name='trades' ORDER BY ordinal_position;

\echo === recent trades ===
SELECT id, product_id, price::text, quantity::text, COALESCE(source,'(null)') AS source,
       buy_order_id, sell_order_id, traded_at
FROM trades
WHERE traded_at > NOW() - INTERVAL '7 days'
ORDER BY traded_at DESC LIMIT 40;

\echo === both matches ===
SELECT id, match_side, lock_status, status, seller_id, buyer_id, created_at
FROM swap_matches
WHERE match_side = 'both'
ORDER BY created_at DESC LIMIT 20;

\echo === trades linked to both matches ===
SELECT m.id AS match_id, m.match_side, m.created_at,
       t.id AS trade_id, t.product_id, t.price::text, COALESCE(t.source,'(null)') AS source, t.traded_at
FROM swap_matches m
JOIN trades t ON t.buy_order_id = m.id OR t.sell_order_id = m.id
WHERE m.match_side = 'both'
ORDER BY m.created_at DESC, t.traded_at DESC
LIMIT 40;

\echo === all swap* trades ===
SELECT id, product_id, price::text, quantity::text, COALESCE(source,'(null)') AS source,
       buy_order_id, sell_order_id, traded_at
FROM trades
WHERE source IN ('swap','swap_private') OR source IS NULL OR source = ''
ORDER BY traded_at DESC LIMIT 30;
"""

sftp = ssh.open_sftp()
with sftp.file("/tmp/check_trades2.sql", "w") as f:
    f.write(sql)
sftp.close()
print(run(f"psql '{url}' -f /tmp/check_trades2.sql 2>&1"))
ssh.close()
