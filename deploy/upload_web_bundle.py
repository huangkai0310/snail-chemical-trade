"""上传本地 standalone 构建产物并启动前端"""
import os
import zipfile
import time
import paramiko

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
REMOTE_WEB = "/opt/snailtrade/web"
ZIP_PATH = os.path.join(os.path.dirname(__file__), "snail-web-bundle.zip")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STANDALONE = os.path.join(ROOT, "web", ".next", "standalone")


def run(ssh, cmd, timeout=60):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return (stdout.read() + stderr.read()).decode().strip()


def make_zip():
    if not os.path.isfile(os.path.join(STANDALONE, "server.js")):
        raise SystemExit("请先本地构建: node node_modules/next/dist/bin/next build")

    if os.path.exists(ZIP_PATH):
        os.remove(ZIP_PATH)

    count = 0
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(STANDALONE):
            dirs[:] = [d for d in dirs if "baiduyun" not in d]
            for f in files:
                if "baiduyun" in f:
                    continue
                full = os.path.join(root, f)
                if not os.path.isfile(full):
                    continue
                arc = os.path.relpath(full, STANDALONE)
                zf.write(full, arc)
                count += 1

    print(f"Zipped {count} files ({os.path.getsize(ZIP_PATH)/1024/1024:.1f} MB)")


def main():
    make_zip()

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

    print("Cleaning stuck npm processes...")
    run(ssh, "pkill -f 'npm install' 2>/dev/null; pkill -f 'npm run build' 2>/dev/null; true")

    print("Uploading bundle...")
    run(ssh, f"mkdir -p {REMOTE_WEB} /opt/snailtrade/logs")
    run(ssh, "systemctl stop snail-web 2>/dev/null || true")
    sftp = ssh.open_sftp()
    sftp.put(ZIP_PATH, "/tmp/snail-web-bundle.zip")
    sftp.close()

    print("Extracting...")
    run(ssh, f"rm -rf {REMOTE_WEB}/* && unzip -qo /tmp/snail-web-bundle.zip -d {REMOTE_WEB} && rm -f /tmp/snail-web-bundle.zip")

    # 补充 static（standalone 可能未包含）
    static_local = os.path.join(ROOT, "web", ".next", "static")
    if os.path.isdir(static_local):
        static_zip = ZIP_PATH.replace("bundle", "static")
        if os.path.exists(static_zip):
            os.remove(static_zip)
        with zipfile.ZipFile(static_zip, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, _, files in os.walk(static_local):
                for f in files:
                    if "baiduyun" in f:
                        continue
                    full = os.path.join(root, f)
                    if os.path.isfile(full):
                        zf.write(full, os.path.relpath(full, static_local))
        sftp = ssh.open_sftp()
        sftp.put(static_zip, "/tmp/snail-static.zip")
        sftp.close()
        run(ssh, f"mkdir -p {REMOTE_WEB}/.next && unzip -qo /tmp/snail-static.zip -d {REMOTE_WEB}/.next/static && rm -f /tmp/snail-static.zip")
        os.remove(static_zip)

    print(run(ssh, f"ls -la {REMOTE_WEB}/server.js"))

    print("Starting service...")
    run(ssh, "systemctl restart snail-web")
    time.sleep(3)
    print(run(ssh, "systemctl status snail-web --no-pager 2>&1 | head -8"))

    local = run(ssh, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/")
    public = run(ssh, "curl -sk -o /dev/null -w '%{http_code}' https://trade.snailchemical.com/")
    print(f"Health: local={local}, public={public}")

    ssh.close()
    if local == "200":
        print("\nDone: https://trade.snailchemical.com")
    else:
        print("\nCheck logs: /opt/snailtrade/logs/web-error.log")


if __name__ == "__main__":
    main()
