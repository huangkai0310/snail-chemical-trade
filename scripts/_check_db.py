import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("115.159.64.125", port=22, username="root", password="Kai&19920310", timeout=30)
cmd = ("PGPASSWORD=snailtrade2024 psql -U snailtrade -h 127.0.0.1 -d snailtrade -t -c \""
       "SELECT 'users', COUNT(*) FROM users UNION ALL "
       "SELECT 'accounts', COUNT(*) FROM accounts UNION ALL "
       "SELECT 'listings', COUNT(*) FROM listings UNION ALL "
       "SELECT 'trades', COUNT(*) FROM trades UNION ALL "
       "SELECT 'swap_listings', COUNT(*) FROM swap_listings UNION ALL "
       "SELECT 'swap_matches', COUNT(*) FROM swap_matches UNION ALL "
       "SELECT 'margin_holds', COUNT(*) FROM margin_holds;\"")
_, stdout, stderr = ssh.exec_command(cmd, timeout=30)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print("ERR:", err[:300])
ssh.close()
