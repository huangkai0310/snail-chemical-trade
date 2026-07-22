"""部署前端静态文件（out/目录）到服务器 nginx root"""
import os
import zipfile
import paramiko
import time

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
REMOTE_WEB_ROOT = "/www/wwwroot/snail-chemical"
REMOTE_ZIP = "/tmp/snail-web-static.zip"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "web", "out")
ZIP_PATH = os.path.join(ROOT, "deploy", "snail-web-static.zip")


def run(ssh, cmd, timeout=60):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    return (out + err).strip()


def package_out():
    if os.path.exists(ZIP_PATH):
        os.remove(ZIP_PATH)

    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for root_dir, dirs, files in os.walk(OUT_DIR):
            for f in files:
                full_path = os.path.join(root_dir, f)
                # arcname is relative to OUT_DIR
                arcname = os.path.relpath(full_path, OUT_DIR)
                zf.write(full_path, arcname)

    size_mb = os.path.getsize(ZIP_PATH) / 1024 / 1024
    print(f"Packaged out/ → {ZIP_PATH} ({size_mb:.1f} MB)")


def deploy():
    print("1. Packaging static files...")
    package_out()

    print("2. Connecting to server...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

    print("3. Uploading zip...")
    sftp = ssh.open_sftp()
    sftp.put(ZIP_PATH, REMOTE_ZIP)
    sftp.close()

    print("4. Deploying files...")
    # Back up old files, then replace
    run(ssh, f"rm -rf {REMOTE_WEB_ROOT}/_next {REMOTE_WEB_ROOT}/*.html {REMOTE_WEB_ROOT}/*.txt")
    run(ssh, f"unzip -qo {REMOTE_ZIP} -d {REMOTE_WEB_ROOT}")
    run(ssh, f"rm -f {REMOTE_ZIP}")

    print("5. Clearing nginx cache...")
    run(ssh, "rm -rf /www/server/nginx/proxy_cache_dir/* 2>/dev/null || true")

    print("6. Reloading nginx...")
    run(ssh, "nginx -t && nginx -s reload")

    print("7. Verifying...")
    time.sleep(2)
    local_code = run(ssh, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/trading.html")
    public_code = run(ssh, "curl -sk -o /dev/null -w '%{http_code}' https://trade.snailchemical.com/trading.html")
    print(f"   local={local_code}, public={public_code}")

    # Also check API endpoint
    api_code = run(ssh, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/v1/products")
    print(f"   API products={api_code}")

    ssh.close()
    print("\n✅ Frontend deploy complete: https://trade.snailchemical.com")


if __name__ == "__main__":
    deploy()
