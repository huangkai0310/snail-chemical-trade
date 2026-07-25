"""Fix api.snailchemical.com nginx CORS (remove * + credentials) and redeploy API."""
import os
import sys

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
NGINX_CONF = "/www/server/panel/vhost/nginx/api.snailchemical.com.conf"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BINARY = os.path.join(ROOT, "backend", "api-gateway", "api-gateway-linux")
CORS_GO = os.path.join(ROOT, "backend", "api-gateway", "middleware", "cors.go")

NEW_CONF = r"""server {
    listen 80;
    server_name api.snailchemical.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.snailchemical.com;

    ssl_certificate /www/server/panel/vhost/nginx/api.snailchemical.com.fullchain.cer;
    ssl_certificate_key /www/server/panel/vhost/nginx/api.snailchemical.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # ACME challenge (HTTP for renewal)
    location ^~ /.well-known/acme-challenge/ {
        root /www/wwwroot/snail-chem-api;
        allow all;
    }

    # CORS 由后端 Go middleware 处理（禁止 Nginx 写 * + credentials，否则浏览器 Failed to fetch）
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Origin $http_origin;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    access_log /www/wwwlogs/api.snailchemical.com.access.log;
    error_log /www/wwwlogs/api.snailchemical.com.error.log;
}
"""


def run(ssh, cmd, timeout=120):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return (stdout.read() + stderr.read()).decode(errors="replace").strip()


def main():
    if not os.path.isfile(BINARY):
        raise SystemExit("missing api-gateway-linux — build first")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    sftp = ssh.open_sftp()

    # backup nginx
    run(ssh, f"cp -a {NGINX_CONF} {NGINX_CONF}.bak.corsfix")
    with sftp.open(NGINX_CONF, "w") as f:
        f.write(NEW_CONF)
    print("nginx conf written")

    # upload binary (with updated CORS allowlist)
    print(run(ssh, "systemctl stop snail-api; echo stopped"))
    sftp.put(BINARY, "/opt/snailtrade/api-gateway")
    sftp.chmod("/opt/snailtrade/api-gateway", 0o755)
    # also patch cors.go on any remote src if exists (noop if missing)
    try:
        sftp.put(CORS_GO, "/tmp/cors.go")
    except Exception:
        pass
    sftp.close()

    print(run(ssh, "nginx -t && nginx -s reload"))
    print(run(ssh, "systemctl start snail-api; sleep 2; systemctl is-active snail-api; curl -s http://127.0.0.1:8080/health"))

    print("--- OPTIONS trade ---")
    print(run("""curl -sk -D- -o /dev/null -X OPTIONS https://api.snailchemical.com/api/v1/admin/market-config \
      -H 'Origin: https://trade.snailchemical.com' \
      -H 'Access-Control-Request-Method: GET' \
      -H 'Access-Control-Request-Headers: authorization,content-type' | head -25"""))

    print("--- GET trade origin ---")
    print(run("""curl -sk -D- -o /dev/null -H 'Origin: https://trade.snailchemical.com' \
      -H 'Authorization: Bearer x' https://api.snailchemical.com/api/v1/admin/market-config | head -20"""))

    print("--- market-status ---")
    print(run("curl -sk https://api.snailchemical.com/api/v1/market-status"))
    ssh.close()
    print("Done.")


if __name__ == "__main__":
    main()
