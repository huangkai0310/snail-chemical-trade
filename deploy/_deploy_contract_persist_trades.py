"""Deploy: keep contract after trades; cancel/expire without trades removes contract."""
import io
import os
import sys
import tarfile

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
REMOTE_DIR = "/opt/snailtrade"
REMOTE_SRC = "/opt/snailtrade/web-src"
REMOTE_WEB = "/www/wwwroot/snail-chemical"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BINARY = os.path.join(ROOT, "backend", "api-gateway", "api-gateway-linux")
WEB = os.path.join(ROOT, "web")
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
        raise SystemExit(f"Binary not found: {BINARY}")

    data = package_web()
    print(f"Web tar: {len(data) // 1024} KB")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    sftp = ssh.open_sftp()

    print("1. Upload API...")
    print(run(ssh, "systemctl stop snail-api 2>&1; echo stopped"))
    sftp.put(BINARY, f"{REMOTE_DIR}/api-gateway")
    sftp.chmod(f"{REMOTE_DIR}/api-gateway", 0o755)

    print("2. Upload web src...")
    web_tar = "/tmp/snail-web-src.tar.gz"
    with sftp.open(web_tar, "wb") as f:
        f.write(data)
    sftp.close()

    print("3. Start API...")
    print(run(ssh, "systemctl reset-failed snail-api; systemctl start snail-api; sleep 2; systemctl is-active snail-api; curl -s http://127.0.0.1:8080/health"))

    print("4. Build web...")
    print(run(ssh, f"""
set -e
mkdir -p {REMOTE_SRC}
tar xzf {web_tar} -C {REMOTE_SRC}
grep -n '已撤盘（部分成交）\\|CountTrades' \\
  {REMOTE_SRC}/src/lib/listing-status.ts \\
  {REMOTE_DIR}/api-gateway >/dev/null 2>&1 || true
grep -n '已撤盘（部分成交）' {REMOTE_SRC}/src/lib/listing-status.ts | head -5
echo SRC_OK
"""))
    print(run(ssh, f"rm -rf {REMOTE_SRC}/.next {REMOTE_SRC}/out /tmp/next-build.log && echo CLEAN_OK"))
    out = run(ssh, f"""
set -e
cd {REMOTE_SRC}
export NODE_OPTIONS=--max-old-space-size=1536
export PATH=/usr/local/bin:$PATH
npx next build > /tmp/next-build.log 2>&1
tail -20 /tmp/next-build.log
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
