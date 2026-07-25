"""Deploy contracts + market status + listing selector."""
import io
import os
import sys
import tarfile

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
REMOTE = "/opt/snailtrade"
REMOTE_SRC = f"{REMOTE}/web-src"
REMOTE_WEB = "/www/wwwroot/snail-chemical"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
BINARY = os.path.join(ROOT, "backend", "api-gateway", "api-gateway-linux")
MIGRATIONS = os.path.join(ROOT, "backend", "api-gateway", "migrations")
SKIP = {"node_modules", ".git", ".next", "out"}


def run(ssh, cmd, timeout=1200):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return (stdout.read() + stderr.read()).decode(errors="replace").strip()


def package_web():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for root, dirs, files in os.walk(WEB):
            dirs[:] = [d for d in dirs if d not in SKIP]
            for f in files:
                if "baiduyun" in f or f == "nul":
                    continue
                full = os.path.join(root, f)
                arc = os.path.relpath(full, WEB).replace("\\", "/")
                tar.add(full, arcname=arc)
    buf.seek(0)
    return buf.read()


def main():
    if not os.path.isfile(BINARY):
        raise SystemExit(f"missing binary: {BINARY}")

    data = package_web()
    print(f"Web tar: {len(data) // 1024} KB")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)
    sftp = ssh.open_sftp()

    print("1. API binary + migrations")
    print(run(ssh, "systemctl stop snail-api; echo stopped"))
    sftp.put(BINARY, f"{REMOTE}/api-gateway")
    sftp.chmod(f"{REMOTE}/api-gateway", 0o755)
    try:
        sftp.stat(f"{REMOTE}/migrations")
    except FileNotFoundError:
        sftp.mkdir(f"{REMOTE}/migrations")
    for name in os.listdir(MIGRATIONS):
        local = os.path.join(MIGRATIONS, name)
        if os.path.isfile(local):
            sftp.put(local, f"{REMOTE}/migrations/{name}")
    print("  uploaded binary + migrations")

    web_tar = "/tmp/snail-web-src.tar.gz"
    with sftp.open(web_tar, "wb") as f:
        f.write(data)
    sftp.close()

    print(run(ssh, "systemctl start snail-api; sleep 2; systemctl is-active snail-api; curl -s http://127.0.0.1:8080/health"))
    print("contracts:", run(ssh, "curl -sk https://api.snailchemical.com/api/v1/products/acetone/contracts | head -c 300"))
    print("market:", run(ssh, "curl -sk https://api.snailchemical.com/api/v1/market-status"))

    print("2. Frontend build")
    print(run(ssh, f"""
set -e
mkdir -p {REMOTE_SRC}
tar xzf {web_tar} -C {REMOTE_SRC}
test -f {REMOTE_SRC}/src/components/ContractSelector.tsx
grep -n '开市' {REMOTE_SRC}/src/components/MarketSummaryPanel.tsx | head -2
echo SRC_OK
"""))
    print(run(ssh, f"rm -rf {REMOTE_SRC}/.next {REMOTE_SRC}/out /tmp/next-build.log && echo CLEAN_OK"))
    out = run(ssh, f"""
set -e
cd {REMOTE_SRC}
export NODE_OPTIONS=--max-old-space-size=1536
export PATH=/usr/local/bin:$PATH
npx next build > /tmp/next-build.log 2>&1
tail -35 /tmp/next-build.log
test -f out/trading.html
echo BUILD_OK
""", timeout=1200)
    print(out)
    if "BUILD_OK" not in out:
        print(run(ssh, "tail -80 /tmp/next-build.log"))
        ssh.close()
        sys.exit(1)

    print(run(ssh, f"""
set -e
rm -rf {REMOTE_WEB}/*
cp -a {REMOTE_SRC}/out/. {REMOTE_WEB}/
rm -f {web_tar}
echo DEPLOY_OK
"""))
    print("trading:", run(ssh, "curl -sk -o /dev/null -w '%{http_code}' https://trade.snailchemical.com/trading.html"))
    ssh.close()
    print("Done.")


if __name__ == "__main__":
    main()
