import paramiko
import time

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"


def run(ssh, cmd, timeout=120):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return (stdout.read() + stderr.read()).decode().strip()


ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

print("=== Current cert files ===")
print(run(ssh, "ls -la /www/server/panel/vhost/nginx/trade.snailchemical.com* 2>&1"))

print("\n=== Issue cert via acme.sh ===")
# HTTP-only nginx first for ACME
nginx_http = """server {
    listen 80;
    server_name trade.snailchemical.com;

    location ^~ /.well-known/acme-challenge/ {
        root /www/wwwroot/snail-chem-api;
        allow all;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
"""
run(ssh, f"cat > /www/server/panel/vhost/nginx/trade.snailchemical.com.conf << 'EOF'\n{nginx_http}EOF")
print(run(ssh, "nginx -t && nginx -s reload"))

print(run(ssh, "~/.acme.sh/acme.sh --issue -d trade.snailchemical.com --webroot /www/wwwroot/snail-chem-api 2>&1 | tail -10", timeout=180))

print(run(ssh, """~/.acme.sh/acme.sh --install-cert -d trade.snailchemical.com \
  --key-file /www/server/panel/vhost/nginx/trade.snailchemical.com.key \
  --fullchain-file /www/server/panel/vhost/nginx/trade.snailchemical.com.fullchain.cer \
  --reloadcmd 'nginx -s reload' 2>&1 | tail -8""", timeout=60))

nginx_ssl = """server {
    listen 80;
    server_name trade.snailchemical.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name trade.snailchemical.com;

    ssl_certificate /www/server/panel/vhost/nginx/trade.snailchemical.com.fullchain.cer;
    ssl_certificate_key /www/server/panel/vhost/nginx/trade.snailchemical.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
"""
run(ssh, f"cat > /www/server/panel/vhost/nginx/trade.snailchemical.com.conf << 'EOF'\n{nginx_ssl}EOF")
print("\n=== nginx test ===")
print(run(ssh, "nginx -t 2>&1"))
print(run(ssh, "nginx -s reload 2>&1"))

time.sleep(2)
print("\n=== API check ===")
print(run(ssh, "curl -sk https://trade.snailchemical.com/api/v1/products 2>&1 | head -c 200"))
print(run(ssh, "curl -sk -o /dev/null -w '%{http_code}' https://trade.snailchemical.com/"))

ssh.close()
