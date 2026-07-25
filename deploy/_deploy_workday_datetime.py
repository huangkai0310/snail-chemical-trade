"""Deploy workday datetime picker + API expires workday validation."""
import io
import os
import sys
import tarfile

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
REMOTE_SRC = "/opt/snailtrade/web-src"
REMOTE_WEB = "/www/wwwroot/snail-chemical"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
EXPIRES_GO = os.path.join(ROOT, "backend", "api-gateway", "handler", "expires.go")
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
    data = package_web()
    print(f"Web tar: {len(data) // 1024} KB")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)
    sftp = ssh.open_sftp()

    # Locate api source on server
    api_root = run(ssh, """
for d in /opt/snailtrade/api-gateway /opt/snailtrade/backend/api-gateway /root/snail-chemical-trade/backend/api-gateway; do
  if [ -f "$d/handler/expires.go" ]; then echo $d; exit 0; fi
done
echo NONE
""")
    print("API root:", api_root)
    if api_root != "NONE":
        sftp.put(EXPIRES_GO, f"{api_root}/handler/expires.go")
        print("Uploaded expires.go")

    web_tar = "/tmp/snail-web-src.tar.gz"
    with sftp.open(web_tar, "wb") as f:
        f.write(data)
    sftp.close()

    if api_root != "NONE":
        print("--- API build ---")
        api_out = run(ssh, f"""
set -e
cd {api_root}
grep -n '须为工作日' handler/expires.go | head -5
export GOPROXY=https://goproxy.cn,direct
go build -o /opt/snailtrade/api-gateway .
systemctl restart snail-api
sleep 2
systemctl is-active snail-api
curl -s http://127.0.0.1:8080/health || true
echo API_OK
""", timeout=600)
        print(api_out)
        if "API_OK" not in api_out:
            print("API deploy failed")
            ssh.close()
            sys.exit(1)

    print("--- WEB ---")
    print(run(ssh, f"""
set -e
mkdir -p {REMOTE_SRC}
tar xzf {web_tar} -C {REMOTE_SRC}
test -f {REMOTE_SRC}/src/components/WorkdayDateTimePicker.tsx
grep -n 'WorkdayDateTimePicker' {REMOTE_SRC}/src/components/CreateListingModal.tsx | head -3
echo SRC_OK
"""))

    print(run(ssh, f"rm -rf {REMOTE_SRC}/.next {REMOTE_SRC}/out /tmp/next-build.log && echo CLEAN_OK"))
    out = run(ssh, f"""
set -e
cd {REMOTE_SRC}
export NODE_OPTIONS=--max-old-space-size=1536
export PATH=/usr/local/bin:$PATH
npx next build > /tmp/next-build.log 2>&1
tail -40 /tmp/next-build.log
test -f out/trading.html
echo BUILD_OK
""", timeout=1200)
    print(out)
    if "BUILD_OK" not in out or "SIGKILL" in out or "Killed" in out:
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
