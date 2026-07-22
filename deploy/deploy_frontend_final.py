#!/usr/bin/env python3
"""
完整前端部署脚本：
1. 本地 npm run build（生成 out/ 静态目录）
2. 打包 out/ 为 tar.gz
3. SFTP 上传到服务器
4. 备份旧静态文件，解压新文件到 /www/wwwroot/snail-chemical/
5. 修改 nginx 配置（保留 /api/ 代理，root 指向 /www/wwwroot/snail-chemical）
6. 重载 nginx
7. 验证
"""

import paramiko
import os
import tarfile
import io
import subprocess
import sys

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
REMOTE_WEB_ROOT = "/www/wwwroot/snail-chemical"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_WEB = os.path.join(ROOT, "web")
LOCAL_OUT = os.path.join(LOCAL_WEB, "out")

# ─── Step 1: 本地构建 ──────────────────────────────────────────
print("=" * 60)
print("Step 1: 检查本地 out/ 目录")
print("=" * 60)

# 跳过本地构建（已在脚本外运行 npm run build）
# 检查 out/ 目录是否存在
if not os.path.exists(LOCAL_OUT):
    print(f"❌ out/ directory not found at {LOCAL_OUT}")
    print("Checking next.config.ts for output: 'export'...")
    config_path = os.path.join(LOCAL_WEB, "next.config.ts")
    with open(config_path) as f:
        print(f.read())
    sys.exit(1)

# 列出 out 目录内容
print(f"\nout/ contents:")
for f in sorted(os.listdir(LOCAL_OUT)):
    fp = os.path.join(LOCAL_OUT, f)
    size = os.path.getsize(fp) if os.path.isfile(fp) else 0
    print(f"  {f} ({size:,} bytes)" if os.path.isfile(fp) else f"  {f}/")

# ─── Step 2: 打包 ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("Step 2: 打包 out/ 为 tar.gz")
print("=" * 60)

buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w:gz") as tar:
    for root, dirs, files in os.walk(LOCAL_OUT):
        for f in files:
            fp = os.path.join(root, f)
            arcname = os.path.relpath(fp, LOCAL_OUT)
            tar.add(fp, arcname=arcname)
buf.seek(0)
data = buf.read()
print(f"Tar size: {len(data) // 1024} KB")

# ─── Step 3-7: SSH 部署 ────────────────────────────────────────
print("\n" + "=" * 60)
print("Step 3: 连接服务器并部署")
print("=" * 60)

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)


def run(cmd, timeout=60):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    return (out + err).strip()


# 上传 tar.gz
print("3a. 上传 tar.gz...")
sftp = ssh.open_sftp()
remote_tar = "/tmp/snail-web-out.tar.gz"
with sftp.open(remote_tar, "wb") as f:
    f.write(data)
sftp.close()
print("    uploaded")

# 备份旧文件 + 解压新文件
print("3b. 备份旧静态文件...")
backup_ts = run("date +%Y%m%d_%H%M%S")
backup_dir = f"{REMOTE_WEB_ROOT}_backup_{backup_ts}"
print(f"    备份到: {backup_dir}")
run(f"cp -r {REMOTE_WEB_ROOT} {backup_dir}")
# 保留 .well-known 目录（ACME 证书验证用）
run(f"mkdir -p {REMOTE_WEB_ROOT}_new")
run(f"cp -r {REMOTE_WEB_ROOT}/.well-known {REMOTE_WEB_ROOT}_new/ 2>/dev/null; true")

print("3c. 解压新文件...")
run(f"cd {REMOTE_WEB_ROOT}_new && tar xzf {remote_tar}")
run(f"ls -la {REMOTE_WEB_ROOT}_new/ | head -20")

print("3d. 替换目录...")
run(f"mv {REMOTE_WEB_ROOT} {REMOTE_WEB_ROOT}_old_{backup_ts}")
run(f"mv {REMOTE_WEB_ROOT}_new {REMOTE_WEB_ROOT}")
run(f"rm -rf {REMOTE_WEB_ROOT}_old_{backup_ts}")
print("    done")

# 更新 nginx 配置
print("\n4. 更新 nginx 配置...")

nginx_conf = f"""server {{
    listen 80;
    listen 443 ssl;
    server_name snailchemical.com www.snailchemical.com;
    root {REMOTE_WEB_ROOT};
    index index.html;

    # Redirect HTTP to HTTPS
    if ($scheme = http) {{
        return 301 https://$server_name$request_uri;
    }}

    # SSL configuration
    ssl_certificate /www/server/panel/vhost/nginx/snail-chemical.pem;
    ssl_certificate_key /www/server/panel/vhost/nginx/snail-chemical.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    gzip_min_length 1024;

    # ACME challenge
    location ^~ /.well-known/acme-challenge/ {{
        root {REMOTE_WEB_ROOT};
        default_type text/plain;
    }}

    # API reverse proxy to Go backend (port 8080)
    location /api/ {{
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }}

    # Next.js static export: try_files for SPA routing
    location / {{
        try_files $uri $uri.html $uri/ /index.html;
    }}

    location /_next/ {{
        expires 1y;
        add_header Cache-Control "public, immutable";
    }}

    access_log /www/wwwlogs/snailchemical.com.log;
    error_log /www/wwwlogs/snailchemical.com.error.log;
}}
"""

conf_path = "/www/server/panel/vhost/nginx/www.snailchemical.com.conf"
# 写入新配置
sftp = ssh.open_sftp()
with sftp.open(conf_path, "w") as f:
    f.write(nginx_conf)
sftp.close()
print(f"    nginx 配置已更新: {conf_path}")

# 测试 nginx 配置
print("\n5. 测试 nginx 配置...")
test_result = run("nginx -t 2>&1")
print(f"    {test_result}")

if "syntax is ok" not in test_result:
    print("❌ nginx 配置测试失败！恢复备份...")
    run(f"cp {backup_dir}/*.conf {conf_path} 2>/dev/null; true")
    ssh.close()
    sys.exit(1)

# 重载 nginx
print("\n6. 重载 nginx...")
print(run("nginx -s reload 2>&1"))

# 停掉不需要的 snail-web 服务（纯静态部署不需要 Next.js SSR）
print("\n7. 停用 snail-web 服务（纯静态部署不需要）...")
print(run("systemctl stop snail-web 2>&1; systemctl disable snail-web 2>&1; echo done"))

# 验证
print("\n" + "=" * 60)
print("Step 8: 验证")
print("=" * 60)

tests = [
    ("首页", "curl -sk -o /dev/null -w '%{http_code}' https://www.snailchemical.com/"),
    ("account 页面", "curl -sk -o /dev/null -w '%{http_code}' https://www.snailchemical.com/account.html"),
    ("my 页面", "curl -sk -o /dev/null -w '%{http_code}' https://www.snailchemical.com/my.html"),
    ("API products", "curl -sk -o /dev/null -w '%{http_code}' https://www.snailchemical.com/api/v1/products"),
]

for name, cmd in tests:
    result = run(cmd)
    status = "✅" if result in ["200", "301"] else "❌"
    print(f"  {status} {name}: {result}")

# 检查首页内容是否是 Next.js
print("\n首页内容检查:")
home_content = run("curl -sk https://www.snailchemical.com/ | head -5")
print(f"  {home_content[:300]}")

# 检查 account 页面内容
print("\naccount 页面内容检查:")
acct_content = run("curl -sk https://www.snailchemical.com/account.html | head -5")
print(f"  {acct_content[:300]}")

ssh.close()
print("\n" + "=" * 60)
print("✅ 部署完成！")
print("=" * 60)
