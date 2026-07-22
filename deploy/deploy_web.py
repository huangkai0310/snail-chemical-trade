"""部署 Next.js 前端到 trade.snailchemical.com（本地构建 + 服务器只装依赖，避免 OOM）"""
import os
import subprocess
import zipfile
import paramiko

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
REMOTE_SRC = "/opt/snailtrade/web-src"
REMOTE_ZIP = "/tmp/snail-web-src.zip"
PORT = 3000

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
ZIP_PATH = os.path.join(ROOT, "deploy", "snail-web-src.zip")

SKIP_DIRS = {"node_modules", ".git"}
SKIP_FILES_SUFFIX = {".baiduyun.uploading.cfg"}

SYSTEMD_UNIT = f"""[Unit]
Description=Snail Chemical Trade Web (Next.js)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory={REMOTE_SRC}
Environment=NODE_ENV=production
Environment=PORT={PORT}
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/local/bin/node {REMOTE_SRC}/node_modules/.bin/next start -p {PORT}
Restart=always
RestartSec=5
MemoryMax=512M
StandardOutput=append:/opt/snailtrade/logs/web.log
StandardError=append:/opt/snailtrade/logs/web-error.log

[Install]
WantedBy=multi-user.target
"""


def run(ssh, cmd, timeout=300):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    return (out + err).strip()


def should_skip(path: str) -> bool:
    parts = path.replace("\\", "/").split("/")
    if any(p in SKIP_DIRS for p in parts):
        return True
    return any(path.endswith(s) for s in SKIP_FILES_SUFFIX)


def package_source():
    if os.path.exists(ZIP_PATH):
        os.remove(ZIP_PATH)

    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(WEB):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                if any(f.endswith(s.lstrip("*")) for s in SKIP_FILES_SUFFIX):
                    continue
                full = os.path.join(root, f)
                if should_skip(full):
                    continue
                arc = os.path.join("web", os.path.relpath(full, WEB))
                try:
                    zf.write(full, arc)
                except FileNotFoundError:
                    pass

    print(f"Packaged source {ZIP_PATH} ({os.path.getsize(ZIP_PATH)/1024/1024:.1f} MB)")


def deploy():
    # Step 0: local build
    print("0. Building locally (npm install + build)...")
    subprocess.run(
        f"npm install",
        cwd=WEB, shell=True, check=True,
    )
    build_result = subprocess.run(
        f"npm run build",
        cwd=WEB, shell=True, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    if build_result.returncode != 0:
        print("BUILD FAILED:")
        print(build_result.stdout)
        print(build_result.stderr)
        return
    tail = build_result.stdout[-500:] if len(build_result.stdout) > 500 else build_result.stdout
    print(tail)

    # Step 1: package source + .next
    package_source()

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

    print("2. Uploading source...")
    run(ssh, f"mkdir -p {REMOTE_SRC} /opt/snailtrade/logs")
    sftp = ssh.open_sftp()
    sftp.put(ZIP_PATH, REMOTE_ZIP)
    sftp.close()

    print("3. Extracting source...")
    run(ssh, f"rm -rf {REMOTE_SRC} && mkdir -p {REMOTE_SRC}")
    run(ssh, f"unzip -qo {REMOTE_ZIP} -d /tmp/snail-src-deploy && cp -a /tmp/snail-src-deploy/web/. {REMOTE_SRC}/ && rm -rf /tmp/snail-src-deploy {REMOTE_ZIP}")

    print("4. Installing production dependencies only (no build)...")
    install_out = run(
        ssh,
        f"cd {REMOTE_SRC} && npm install --omit=dev 2>&1 | tail -10",
        timeout=300,
    )
    print(install_out)

    print("5. Configuring systemd...")
    run(ssh, "systemctl stop snail-web 2>/dev/null || true")
    run(ssh, f"cat > /etc/systemd/system/snail-web.service << 'EOF'\n{SYSTEMD_UNIT}EOF")
    run(ssh, "systemctl daemon-reload && systemctl enable snail-web")

    print("6. Configuring nginx...")
    nginx_http = """server {
    listen 80;
    server_name trade.snailchemical.com;

    location ^~ /.well-known/acme-challenge/ {
        root /www/wwwroot/snail-chem-api;
        allow all;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_no_cache 1;
        proxy_cache_bypass 1;
    }
}
"""
    run(ssh, f"cat > /www/server/panel/vhost/nginx/trade.snailchemical.com.conf << 'NGINXEOF'\n{nginx_http}NGINXEOF")
    run(ssh, "nginx -t && nginx -s reload")

    cert_exists = "yes" in run(
        ssh, "test -f /www/server/panel/vhost/nginx/trade.snailchemical.com.fullchain.cer && echo yes"
    )
    if not cert_exists:
        print("7. Issuing SSL...")
        run(ssh, "~/.acme.sh/acme.sh --issue -d trade.snailchemical.com --nginx 2>&1 | tail -8", timeout=180)
        run(ssh, """~/.acme.sh/acme.sh --install-cert -d trade.snailchemical.com \
            --key-file /www/server/panel/vhost/nginx/trade.snailchemical.com.key \
            --fullchain-file /www/server/panel/vhost/nginx/trade.snailchemical.com.fullchain.cer \
            --reloadcmd 'nginx -s reload' 2>&1 | tail -5""", timeout=60)

    nginx_ssl = """server {
    listen 80;
    server_name trade.snailchemical.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name trade.snailchemical.com;

    ssl_certificate /www/server/panel/vhost/nginx/trade.snailchemical.com.fullchain.cer;
    ssl_certificate_key /www/server/panel/vhost/nginx/trade.snailchemical.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_no_cache 1;
        proxy_cache_bypass 1;
    }

    access_log /www/wwwlogs/trade.snailchemical.com.access.log;
    error_log /www/wwwlogs/trade.snailchemical.com.error.log;
}
"""
    run(ssh, f"cat > /www/server/panel/vhost/nginx/trade.snailchemical.com.conf << 'NGINXEOF'\n{nginx_ssl}NGINXEOF")
    run(ssh, "nginx -t && nginx -s reload")

    print("7. Starting service...")
    run(ssh, "systemctl start snail-web")
    import time
    time.sleep(5)
    print(run(ssh, "systemctl status snail-web --no-pager 2>&1 | head -10"))

    # Clear Nginx proxy cache to avoid serving stale pages
    run(ssh, "rm -rf /www/server/nginx/proxy_cache_dir/* 2>/dev/null || true")
    print("8. Cleared Nginx proxy cache")

    local_code = run(ssh, f"curl -s -o /dev/null -w '%{{http_code}}' http://127.0.0.1:{PORT}/")
    public_code = run(ssh, "curl -sk -o /dev/null -w '%{http_code}' https://trade.snailchemical.com/")
    print(f"9. HTTP check: local={local_code}, public={public_code}")

    ssh.close()
    print("\nFrontend deploy complete: https://trade.snailchemical.com")


if __name__ == "__main__":
    deploy()
