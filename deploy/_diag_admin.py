"""Diagnose admin auth / nginx / static files on production."""
import paramiko
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"


def run(ssh, cmd, timeout=60):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return (stdout.read() + stderr.read()).decode(errors="replace").strip()


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

    print("=== HTTP codes ===")
    for p in [
        "/admin",
        "/admin/",
        "/admin/auth",
        "/admin/auth.html",
        "/admin/products",
        "/admin/_next/static",
    ]:
        code = run(ssh, f"curl -sk -o /dev/null -w '%{{http_code}}' 'https://trade.snailchemical.com{p}'")
        print(f"  {code}  {p}")

    print("\n=== auth.html head snippet ===")
    print(run(ssh, "curl -sk 'https://trade.snailchemical.com/admin/auth' | head -c 1200"))

    print("\n=== JS/CSS asset refs in auth.html ===")
    print(run(ssh, "curl -sk 'https://trade.snailchemical.com/admin/auth' | grep -oE '/admin/_next/[^\" ]+' | head -20"))

    print("\n=== first JS asset status ===")
    js = run(ssh, "curl -sk 'https://trade.snailchemical.com/admin/auth' | grep -oE '/admin/_next/static/[^\"]+\\.js' | head -1")
    print("js path:", js)
    if js:
        print("js code:", run(ssh, f"curl -sk -o /dev/null -w '%{{http_code}}' 'https://trade.snailchemical.com{js}'"))

    print("\n=== remote file tree (admin root) ===")
    print(run(ssh, "ls -la /www/wwwroot/snail-trade-admin | head -30"))
    print(run(ssh, "ls -la /www/wwwroot/snail-trade-admin/admin | head -30"))
    print(run(ssh, "ls /www/wwwroot/snail-trade-admin/_next/static 2>/dev/null | head -10"))

    print("\n=== nginx admin blocks ===")
    print(run(ssh, "grep -n -A8 'location.*/admin' /www/server/panel/vhost/nginx/trade.snailchemical.com.conf | head -60"))

    print("\n=== API login smoke (expect 401/400 not 502) ===")
    print(run(ssh, """curl -sk -o /tmp/login.json -w '%{http_code}' -X POST https://api.snailchemical.com/api/v1/auth/login -H 'Content-Type: application/json' -d '{"username":"x","password":"y"}'; echo; cat /tmp/login.json | head -c 300"""))

    ssh.close()


if __name__ == "__main__":
    main()
