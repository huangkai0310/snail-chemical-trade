"""恢复并部署前端：使用 /opt/snailtrade/web-src 已有 node_modules 构建"""
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
REMOTE_DIR = "/www/wwwroot/snail-chemical"
BACKUP = "/www/wwwroot/snail-chemical_backup_20260625_153256"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
SKIP = {"node_modules", ".git", ".next", "out"}


def run(ssh, cmd, timeout=900):
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
                # Windows relpath 可能含反斜杠，Linux 解压需统一为正斜杠
                arc = os.path.relpath(full, WEB).replace("\\", "/")
                tar.add(full, arcname=arc)
    buf.seek(0)
    return buf.read()


def main():
    data = package_web()
    print(f"Source tar: {len(data)//1024} KB")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

    print("1. Restore site from backup (fix 403)...")
    print(run(ssh, f"mkdir -p {REMOTE_DIR} && cp -a {BACKUP}/. {REMOTE_DIR}/ && echo RESTORED"))

    print("2. Upload latest web source...")
    sftp = ssh.open_sftp()
    remote_tar = "/tmp/snail-web-src.tar.gz"
    with sftp.open(remote_tar, "wb") as f:
        f.write(data)
    sftp.close()

    print("3. Update web-src and build...")
    build_cmd = f"""
set -e
mkdir -p {REMOTE_SRC}
tar xzf {remote_tar} -C {REMOTE_SRC}
cd {REMOTE_SRC}
# 确认发盘列表分页源码已更新
grep -n 'const pageSize' src/components/ListingPanel.tsx
grep -c '上一页' src/components/ListingPanel.tsx
export NODE_OPTIONS=--max-old-space-size=2048
export PATH=/usr/local/bin:$PATH
npm install 2>&1 | tail -10
npx next build 2>&1 | tail -30
test -f out/index.html && echo BUILD_OK
"""
    print(run(ssh, build_cmd, timeout=900))

    print("4. Deploy out/ to production...")
    deploy_cmd = f"""
set -e
rm -rf {REMOTE_DIR}/*
cp -a {REMOTE_SRC}/out/. {REMOTE_DIR}/
rm -f {remote_tar}
echo DEPLOY_OK
ls {REMOTE_DIR} | head -15
"""
    print(run(ssh, deploy_cmd, timeout=120))

    print("5. Verify...")
    print("trade:", run(ssh, "curl -sk -o /dev/null -w '%{http_code}' https://trade.snailchemical.com/"))
    print("trading:", run(ssh, "curl -sk -o /dev/null -w '%{http_code}' https://trade.snailchemical.com/trading.html"))

    ssh.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
