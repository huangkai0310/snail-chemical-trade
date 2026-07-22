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
SELECT 'L' AS k,
  encode(convert_to(COALESCE(delivery_period,''), 'UTF8'), 'hex') AS dp,
  encode(convert_to(COALESCE(delivery_location,''), 'UTF8'), 'hex') AS loc,
  encode(convert_to(COALESCE(delivery_method,''), 'UTF8'), 'hex') AS dm,
  encode(convert_to(COALESCE(payment_method,''), 'UTF8'), 'hex') AS pm,
  price::text, free_storage_enabled::text, free_storage_days::text, side
FROM listings WHERE serial_no=17408
UNION ALL
SELECT 'Sbuy',
  encode(convert_to(COALESCE(buy_delivery_period,''), 'UTF8'), 'hex'),
  encode(convert_to(COALESCE(buy_delivery_location,''), 'UTF8'), 'hex'),
  encode(convert_to(COALESCE(buy_delivery_method,''), 'UTF8'), 'hex'),
  encode(convert_to(COALESCE(buy_payment_method,''), 'UTF8'), 'hex'),
  buy_price::text, buy_free_storage_enabled::text, buy_free_storage_days::text, 'BUY'
FROM swap_listings WHERE serial_no=57
UNION ALL
SELECT 'Ssell',
  encode(convert_to(COALESCE(sell_delivery_period,''), 'UTF8'), 'hex'),
  encode(convert_to(COALESCE(sell_delivery_location,''), 'UTF8'), 'hex'),
  encode(convert_to(COALESCE(sell_delivery_method,''), 'UTF8'), 'hex'),
  encode(convert_to(COALESCE(sell_payment_method,''), 'UTF8'), 'hex'),
  sell_price::text, sell_free_storage_enabled::text, sell_free_storage_days::text, 'SELL'
FROM swap_listings WHERE serial_no=57;
"""

print(run(f"psql '{url}' -c \"{sql}\" 2>&1"))

# also convert hex on local via python after fetch
out = run(f"""psql '{url}' -t -A -F '|' -c "SELECT 'L|'||encode(convert_to(COALESCE(delivery_period,''),'UTF8'),'hex')||'|'||encode(convert_to(COALESCE(delivery_location,''),'UTF8'),'hex')||'|'||encode(convert_to(COALESCE(delivery_method,''),'UTF8'),'hex')||'|'||encode(convert_to(COALESCE(payment_method,''),'UTF8'),'hex')||'|'||price||'|'||COALESCE(specs::text,'') FROM listings WHERE serial_no=17408; SELECT 'Sb|'||encode(convert_to(COALESCE(buy_delivery_period,''),'UTF8'),'hex')||'|'||encode(convert_to(COALESCE(buy_delivery_location,''),'UTF8'),'hex')||'|'||encode(convert_to(COALESCE(buy_delivery_method,''),'UTF8'),'hex')||'|'||encode(convert_to(COALESCE(buy_payment_method,''),'UTF8'),'hex')||'|'||buy_price||'|'||COALESCE(buy_specs::text,'') FROM swap_listings WHERE serial_no=57; SELECT 'Ss|'||encode(convert_to(COALESCE(sell_delivery_period,''),'UTF8'),'hex')||'|'||encode(convert_to(COALESCE(sell_location,''),'UTF8'),'hex') FROM swap_listings WHERE serial_no=57;" 2>&1""")
print("RAW:", out)
ssh.close()

# decode locally
for line in out.strip().splitlines():
    parts = line.split("|")
    if len(parts) < 2: continue
    tag = parts[0]
    decoded = [tag]
    for p in parts[1:]:
        try:
            if all(c in "0123456789abcdef" for c in p.lower()) and len(p) % 2 == 0 and p:
                decoded.append(bytes.fromhex(p).decode("utf-8"))
            else:
                decoded.append(p)
        except Exception:
            decoded.append(p)
    print(decoded)
