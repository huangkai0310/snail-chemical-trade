"""诊断服务器 Node 环境并恢复前端"""
import paramiko

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"


def run(ssh, cmd, timeout=120):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return (stdout.read() + stderr.read()).decode(errors="replace").strip()


ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

cmds = [
    "which node; which npm; node -v 2>&1; npm -v 2>&1",
    "ls -la /opt/snailtrade/web-src/package.json 2>&1",
    "ls -la /opt/snailtrade/web-src/node_modules/next/package.json 2>&1",
    "ls /www/wwwroot/ 2>&1",
    "ls /www/wwwroot/snail-chemical/ 2>&1 | head -20",
    "ls -d /www/wwwroot/snail-chemical_backup_* 2>/dev/null | tail -3",
]
for c in cmds:
    print("===", c[:60], "===")
    print(run(ssh, c))
    print()

ssh.close()
