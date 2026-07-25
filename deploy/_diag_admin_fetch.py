import paramiko
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("115.159.64.125", username="root", password="Kai&19920310", timeout=30)


def run(cmd):
    _, o, e = ssh.exec_command(cmd, timeout=60)
    return (o.read() + e.read()).decode(errors="replace")


print("=== nginx admin/api hints ===")
print(run("grep -RIn 'snail-trade-admin\\|admin.snail\\|location /admin\\|api.snail' /www/server/panel/vhost/nginx/ 2>/dev/null | head -60"))

print("=== CORS with trade origin ===")
print(run("""curl -sk -D- -o /tmp/body.json -H 'Origin: https://trade.snailchemical.com' -H 'Authorization: Bearer x' https://api.snailchemical.com/api/v1/admin/market-config | head -30; echo BODY:; head -c 200 /tmp/body.json; echo"""))

print("=== CORS with admin subdomain ===")
print(run("""curl -sk -D- -o /dev/null -H 'Origin: https://admin.snailchemical.com' https://api.snailchemical.com/api/v1/market-status | head -25"""))

print("=== admin JS API base ===")
print(run("grep -roh 'api.snailchemical\\|localhost:8080\\|NEXT_PUBLIC' /www/wwwroot/snail-trade-admin/ 2>/dev/null | sort | uniq -c | head"))
print(run("ls /www/wwwroot/snail-trade-admin/ | head -20"))
print(run("ls /www/wwwroot/snail-chem-admin/ 2>/dev/null | head -20"))

print("=== OPTIONS trade ===")
print(run("""curl -sk -D- -o /dev/null -X OPTIONS https://api.snailchemical.com/api/v1/admin/market-config -H 'Origin: https://trade.snailchemical.com' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization,content-type' | head -30"""))

ssh.close()
