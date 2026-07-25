"""部署量化交易管理后台到 trade.snailchemical.com/admin"""
import paramiko, os, tarfile, io

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
REMOTE_DIR = "/www/wwwroot/snail-trade-admin"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_OUT = os.path.join(ROOT, "web-admin", "out")

# 创建内存 tar.gz
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w:gz") as tar:
    for root, dirs, files in os.walk(LOCAL_OUT):
        for f in files:
            fp = os.path.join(root, f)
            arcname = os.path.relpath(fp, LOCAL_OUT)
            tar.add(fp, arcname=arcname)
buf.seek(0)
data = buf.read()
print(f"Tar size: {len(data)//1024} KB")


def run(ssh, cmd):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    return (stdout.read() + stderr.read()).decode().strip()


ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
print("Connecting...")
ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

# Step 1: Upload
print("1. Uploading...")
sftp = ssh.open_sftp()
try:
    sftp.stat(REMOTE_DIR)
except FileNotFoundError:
    run(ssh, f"mkdir -p {REMOTE_DIR}")
with sftp.open(REMOTE_DIR + "/out.tar.gz", "wb") as f:
    f.write(data)
sftp.close()
print("   uploaded")

# Step 2: Extract
print("2. Extracting...")
result = run(ssh, f"tar xzf {REMOTE_DIR}/out.tar.gz -C {REMOTE_DIR}/ && echo OK")
print(f"   {result}")
# Copy auth.html to admin/ subdirectory (auth is root-level route in app router)
run(ssh, f"cp {REMOTE_DIR}/auth.html {REMOTE_DIR}/admin/auth.html")
print("   auth.html copied to admin/")
run(ssh, f"rm -f {REMOTE_DIR}/out.tar.gz")

# Step 3: Update nginx — use root instead of alias
print("3. Reading current nginx config...")
_, stdout, _ = ssh.exec_command("cat /www/server/panel/vhost/nginx/trade.snailchemical.com.conf")
current_nginx = stdout.read().decode()
print(f"   {len(current_nginx)} bytes")

admin_blocks = """
    # /admin = 量化交易管理后台（静态导出，Next.js 15）
    location = /admin {
        root /www/wwwroot/snail-trade-admin;
        try_files /admin.html =404;
    }

    location /admin/ {
        root /www/wwwroot/snail-trade-admin;
        try_files $uri $uri.html =404;
    }

"""

if "location /admin" not in current_nginx:
    old_block = "    location / {"
    new_nginx = current_nginx.replace(old_block, admin_blocks + old_block, 1)
    sftp = ssh.open_sftp()
    with sftp.open("/www/server/panel/vhost/nginx/trade.snailchemical.com.conf", "w") as f:
        f.write(new_nginx)
    sftp.close()
    print("   /admin location inserted")
else:
    print("   /admin location already exists, checking config...")
    # Re-write with corrected root directive if using wrong approach
    if "alias /www/wwwroot/snail-trade-admin" in current_nginx:
        new_nginx = current_nginx.replace("alias /www/wwwroot/snail-trade-admin", "root /www/wwwroot/snail-trade-admin")
        sftp = ssh.open_sftp()
        with sftp.open("/www/server/panel/vhost/nginx/trade.snailchemical.com.conf", "w") as f:
            f.write(new_nginx)
        sftp.close()
        print("   Fixed: alias → root")
    else:
        new_nginx = current_nginx

# Step 4: Test and reload
print("4. Testing nginx...")
_, stdout, stderr = ssh.exec_command("nginx -t 2>&1")
test = (stdout.read() + stderr.read()).decode()
print(f"   {test}")
if "test is successful" in test or "syntax is ok" in test:
    ssh.exec_command("nginx -s reload")
    print("   nginx reloaded")
else:
    print("   !!! FAILED, reverting...")
    sftp = ssh.open_sftp()
    with sftp.open("/www/server/panel/vhost/nginx/trade.snailchemical.com.conf", "w") as f:
        f.write(current_nginx)
    sftp.close()
    ssh.close()
    exit(1)

# Step 5: Verify all routes
print("5. Testing routes...")
tests = {
    "/admin": "dashboard",
    "/admin/cron-tasks": "cron-tasks",
    "/admin/products": "products",
    "/admin/dict": "dict",
    "/admin/holidays": "holidays",
    "/admin/market-config": "market-config",
}
all_ok = True
for path, desc in tests.items():
    _, stdout, _ = ssh.exec_command(f'curl -sk -o /dev/null -w "%{{http_code}}" "https://trade.snailchemical.com{path}"')
    code = stdout.read().decode().strip()
    status = "✅" if code == "200" else "❌"
    print(f"   {status} {path} → {code} ({desc})")
    if code != "200":
        all_ok = False

# auth at /admin/auth
_, stdout, _ = ssh.exec_command('curl -sk -o /dev/null -w "%{http_code}" "https://trade.snailchemical.com/admin/auth"')
code = stdout.read().decode().strip()
status = "✅" if code == "200" else "❌"
print(f"   {status} /admin/auth → {code} (login)")

if all_ok:
    print("\n✅ All routes OK!")
else:
    print("\n⚠️ Some routes failed — check nginx config")

ssh.close()
print(f"\n✅ Admin deploy complete: https://trade.snailchemical.com/admin")
