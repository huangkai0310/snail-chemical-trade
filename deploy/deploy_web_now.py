"""部署前端到 trade.snailchemical.com（/www/wwwroot/snail-chemical）"""
import paramiko, os, tarfile, io

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
REMOTE_DIR = "/www/wwwroot/snail-chemical"  # trade.snailchemical.com 的 nginx root

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_OUT = os.path.join(ROOT, "web", "out")

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

print("1. Uploading...")
sftp = ssh.open_sftp()
with sftp.open(REMOTE_DIR + "/out.tar.gz", "wb") as f:
    f.write(data)
sftp.close()
print("   uploaded")

print("2. Extracting (preserve .well-known)...")
# 备份 .well-known（Let's Encrypt ACME 目录）
run(ssh, f"if [ -d {REMOTE_DIR}/.well-known ]; then cp -r {REMOTE_DIR}/.well-known /tmp/.well-known_bak; fi")
# 清空目录（只保留 .well-known）
run(ssh, f"cd {REMOTE_DIR} && find . -maxdepth 1 ! -name '.well-known' ! -name 'out.tar.gz' ! -name '.' -delete 2>/dev/null; true")
# 解压
result = run(ssh, f"tar xzf {REMOTE_DIR}/out.tar.gz -C {REMOTE_DIR}/ && echo OK")
print(f"   {result}")
# 恢复 .well-known
run(ssh, f"if [ -d /tmp/.well-known_bak ]; then cp -r /tmp/.well-known_bak {REMOTE_DIR}/.well-known; rm -rf /tmp/.well-known_bak; fi")
# 清理 tar.gz
run(ssh, f"rm -f {REMOTE_DIR}/out.tar.gz")

print("3. Test...")
trade = run(ssh, 'curl -sk -o /dev/null -w "%{http_code}" https://trade.snailchemical.com/')
trading = run(ssh, 'curl -sk -o /dev/null -w "%{http_code}" https://trade.snailchemical.com/trading.html')
www = run(ssh, 'curl -sk -o /dev/null -w "%{http_code}" https://www.snailchemical.com/')
print(f"   trade.snailchemical.com={trade}")
print(f"   trade.snailchemical.com/trading.html={trading}")
print(f"   www.snailchemical.com={www} (should be official website)")

ssh.close()
print("Frontend deploy complete.")
