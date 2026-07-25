"""Deploy admin backend CORS + fixed admin frontend."""
import io
import os
import sys
import tarfile
import time

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
REMOTE_DIR = "/opt/snailtrade"
REMOTE_ADMIN_SRC = "/opt/snailtrade/web-admin-src"
REMOTE_ADMIN_WEB = "/www/wwwroot/snail-trade-admin"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BINARY = os.path.join(ROOT, "backend", "api-gateway", "api-gateway-linux")
WEB_ADMIN = os.path.join(ROOT, "web-admin")
SKIP = {"node_modules", ".git", ".next", "out"}


def run(ssh, cmd, timeout=1200):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return (stdout.read() + stderr.read()).decode(errors="replace").strip()


def package_admin():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for root, dirs, files in os.walk(WEB_ADMIN):
            dirs[:] = [d for d in dirs if d not in SKIP]
            for f in files:
                if "baiduyun" in f or f == "nul":
                    continue
                full = os.path.join(root, f)
                arc = os.path.relpath(full, WEB_ADMIN).replace("\\", "/")
                tar.add(full, arcname=arc)
    buf.seek(0)
    return buf.read()


def main():
    if not os.path.isfile(BINARY):
        print("Building linux binary...")
        # caller should build; try local go
        env = os.environ.copy()
        env["GOOS"] = "linux"
        env["GOARCH"] = "amd64"
        env["CGO_ENABLED"] = "0"
        env["GOPROXY"] = "https://goproxy.cn,direct"
        import subprocess
        subprocess.check_call(
            ["go", "build", "-o", "api-gateway-linux", "."],
            cwd=os.path.join(ROOT, "backend", "api-gateway"),
            env=env,
        )

    print(f"Binary: {os.path.getsize(BINARY)//1024} KB")
    admin_tar = package_admin()
    print(f"Admin src: {len(admin_tar)//1024} KB")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

    sftp = ssh.open_sftp()
    print("1. Upload API binary...")
    sftp.put(BINARY, f"{REMOTE_DIR}/api-gateway-linux.new")

    print("2. Upload admin source...")
    remote_tar = "/tmp/snail-admin-src.tar.gz"
    with sftp.open(remote_tar, "wb") as f:
        f.write(admin_tar)
    sftp.close()

    print("3. Restart API...")
    print(run(ssh, f"""
set -e
cd {REMOTE_DIR}
mv -f api-gateway-linux.new api-gateway-linux
chmod +x api-gateway-linux
systemctl restart snail-api || (pkill -f api-gateway-linux || true; nohup ./api-gateway-linux >/var/log/snail-api.log 2>&1 &)
sleep 2
curl -sk -o /dev/null -w '%{{http_code}}' https://api.snailchemical.com/health || true
echo
"""))

    print("4. Build admin frontend...")
    out = run(ssh, f"""
set -e
mkdir -p {REMOTE_ADMIN_SRC}
tar xzf {remote_tar} -C {REMOTE_ADMIN_SRC}
rm -rf {REMOTE_ADMIN_SRC}/.next {REMOTE_ADMIN_SRC}/out
cd {REMOTE_ADMIN_SRC}
export NODE_OPTIONS=--max-old-space-size=1536
export PATH=/usr/local/bin:$PATH
if [ ! -d node_modules ]; then npm install --prefer-offline 2>&1 | tail -15; fi
npx next build > /tmp/admin-build.log 2>&1
tail -30 /tmp/admin-build.log
test -f out/auth.html
echo BUILD_OK
""", timeout=1200)
    print(out)
    if "BUILD_OK" not in out:
        print(run(ssh, "tail -80 /tmp/admin-build.log"))
        ssh.close()
        sys.exit(1)

    print("5. Deploy admin static...")
    print(run(ssh, f"""
set -e
mkdir -p {REMOTE_ADMIN_WEB}
find {REMOTE_ADMIN_WEB} -mindepth 1 -maxdepth 1 -exec rm -rf {{}} +
cp -a {REMOTE_ADMIN_SRC}/out/. {REMOTE_ADMIN_WEB}/
mkdir -p {REMOTE_ADMIN_WEB}/admin
cp -f {REMOTE_ADMIN_WEB}/auth.html {REMOTE_ADMIN_WEB}/admin/auth.html
# copy nested admin pages if exported under out/admin/
if [ -d {REMOTE_ADMIN_WEB}/admin ]; then
  # ensure products etc under admin/
  for f in products dict holidays market-config cron-tasks; do
    if [ -f {REMOTE_ADMIN_WEB}/admin/$f.html ]; then :; fi
  done
fi
rm -f {remote_tar}
echo DEPLOY_OK
"""))

    print("6. Verify...")
    print("auth:", run(ssh, "curl -sk -o /dev/null -w '%{http_code}' https://trade.snailchemical.com/admin/auth"))
    print("js:", run(ssh, "curl -sk -o /dev/null -w '%{http_code}' https://trade.snailchemical.com/admin/_next/static/chunks/webpack-ee0bc8f605aa9140.js || true"))
    # CORS preflight
    print("cors:", run(ssh, """curl -sk -o /dev/null -w '%{http_code}' -X OPTIONS https://api.snailchemical.com/api/v1/auth/login -H 'Origin: https://trade.snailchemical.com' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type'"""))
    print("cors-hdr:", run(ssh, """curl -sk -D - -o /dev/null -X OPTIONS https://api.snailchemical.com/api/v1/auth/login -H 'Origin: https://trade.snailchemical.com' -H 'Access-Control-Request-Method: POST' | grep -i access-control | head -5"""))
    ssh.close()
    print("Done.")


if __name__ == "__main__":
    main()
