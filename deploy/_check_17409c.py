# -*- coding: utf-8 -*-
import paramiko, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("115.159.64.125", port=22, username="root", password="Kai&19920310", timeout=30)

# Find POST listings around create times
_, stdout, _ = ssh.exec_command(
    "journalctl -u snail-api --since '2026-07-17 14:19:40' --until '2026-07-17 14:21:00' --no-pager 2>&1 | grep -E 'POST|PATCH|listings/' ",
    timeout=30,
)
print(stdout.read().decode("utf-8", errors="replace"))

# Current orderbook via API (no auth needed?)
_, stdout, _ = ssh.exec_command(
    "curl -s 'http://127.0.0.1:8080/api/v1/orderbook/acetone?delivery_period=%E7%8E%B0%E8%B4%A7' | python3 -c \"import sys,json; d=json.load(sys.stdin); print('bids',len(d.get('bids',[])),'asks',len(d.get('asks',[])));\n"
    "[print('BID',o.get('id','')[:8],o.get('price'),o.get('quantity'),o.get('filled'),o.get('delivery_period'),o.get('delivery_method'),o.get('free_storage_enabled'),o.get('free_storage_days'),o.get('min_quantity'),o.get('allow_partial')) for o in d.get('bids',[])];\n"
    "[print('ASK',o.get('id','')[:8],o.get('price'),o.get('quantity'),o.get('filled'),o.get('delivery_period'),o.get('delivery_method'),o.get('free_storage_enabled'),o.get('free_storage_days'),o.get('min_quantity'),o.get('allow_partial')) for o in d.get('asks',[])]\"",
    timeout=30,
)
print("--- orderbook ---")
print(stdout.read().decode("utf-8", errors="replace"))

ssh.close()
