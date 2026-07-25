import paramiko
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("115.159.64.125", username="root", password="Kai&19920310", timeout=30)

def run(cmd):
    _, o, e = ssh.exec_command(cmd, timeout=60)
    return (o.read() + e.read()).decode(errors="replace").strip()

print("=== POST login with Origin ===")
print(run("""curl -sk -D - -o /tmp/login_body.json -X POST https://api.snailchemical.com/api/v1/auth/login \
  -H 'Origin: https://trade.snailchemical.com' \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | head -30; echo '---'; cat /tmp/login_body.json | head -c 400"""))

print("\n=== brand in auth html ===")
print(run("curl -sk https://trade.snailchemical.com/admin/auth | grep -oE 'auth-shell|禾合|ChemBridge' | sort -u"))

print("\n=== latest webpack chunk ===")
print(run("ls /www/wwwroot/snail-trade-admin/_next/static/chunks/webpack-*.js | head -1"))
js = run("ls /www/wwwroot/snail-trade-admin/_next/static/chunks/webpack-*.js | head -1 | xargs -I{} basename {}")
print("file", js)
print("http", run(f"curl -sk -o /dev/null -w '%{{http_code}}' https://trade.snailchemical.com/admin/_next/static/chunks/{js}"))

ssh.close()
