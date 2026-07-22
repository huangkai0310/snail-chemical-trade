import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
REMOTE_SRC = "/opt/snailtrade/web-src"
REMOTE_DIR = "/www/wwwroot/snail-chemical"

def run(ssh, cmd, timeout=120):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return (stdout.read() + stderr.read()).decode(errors="replace").strip()

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

print("out exists:", run(ssh, f"test -f {REMOTE_SRC}/out/index.html && echo yes || echo no"))
print("build status:", run(ssh, f"ls -la {REMOTE_SRC}/out/ 2>&1 | head -5"))

if "yes" in run(ssh, f"test -f {REMOTE_SRC}/out/index.html && echo yes"):
    print("Deploying...")
    print(run(ssh, f"rm -rf {REMOTE_DIR}/* && cp -a {REMOTE_SRC}/out/. {REMOTE_DIR}/ && echo DEPLOY_OK"))
else:
    print("Rebuilding...")
    print(run(ssh, f"cd {REMOTE_SRC} && export PATH=/usr/local/bin:$PATH && npx next build 2>&1 | tail -15", timeout=900))
    print(run(ssh, f"rm -rf {REMOTE_DIR}/* && cp -a {REMOTE_SRC}/out/. {REMOTE_DIR}/ && echo DEPLOY_OK"))

print("trade:", run(ssh, "curl -sk -o /dev/null -w '%{http_code}' https://trade.snailchemical.com/"))
print("trading:", run(ssh, "curl -sk -o /dev/null -w '%{http_code}' https://trade.snailchemical.com/trading.html"))
ssh.close()
