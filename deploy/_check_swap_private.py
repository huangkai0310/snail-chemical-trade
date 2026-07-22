#!/usr/bin/env python3
"""Check why bilateral swap trades still affect market price."""
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
print("DB ok:", url.split("@")[-1] if "@" in url else "yes")

sql = r"""
\echo === source counts ===
SELECT COALESCE(source,'(null)') AS source, count(*) FROM trades GROUP BY 1 ORDER BY 2 DESC;

\echo === recent trades (3d) ===
SELECT t.id, t.product_id, t.price::text, t.quantity::text, COALESCE(t.source,'(null)') AS source,
       t.traded_at, m.match_side, m.lock_status, m.taker_id IS NOT NULL AS has_taker
FROM trades t
LEFT JOIN swap_matches m ON m.id = t.buy_order_id
WHERE t.traded_at > NOW() - INTERVAL '3 days'
ORDER BY t.traded_at DESC LIMIT 30;

\echo === both-side matches vs trade source ===
SELECT m.id, m.match_side, m.lock_status, m.status, m.created_at,
       tb.source AS buy_src, ts.source AS sell_src, tb.price AS buy_px, ts.price AS sell_px
FROM swap_matches m
LEFT JOIN trades tb ON tb.buy_order_id = m.id AND tb.side = 'buy'
LEFT JOIN trades ts ON ts.buy_order_id = m.id AND ts.side = 'sell'
WHERE m.match_side = 'both' OR m.created_at > NOW() - INTERVAL '7 days'
ORDER BY m.created_at DESC LIMIT 20;

\echo === migration 034 ===
SELECT * FROM schema_migrations WHERE filename LIKE '%034%' OR filename LIKE '%private%';
"""

sftp = ssh.open_sftp()
with sftp.file("/tmp/check_trades.sql", "w") as f:
    f.write(sql)
sftp.close()

print(run(f"psql '{url}' -f /tmp/check_trades.sql 2>&1"))
ssh.close()
