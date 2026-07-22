"""
查询当前服务器上 admin 用户的密码 hash，并验证 test123456
"""
import paramiko

HOST = "115.159.64.125"
SSH_USER = "root"
SSH_PASSWORD = "Kai&19920310"
DB_USER = "snailtrade"
DB_PASS = "snailtrade2024"
DB_NAME = "snailtrade"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=SSH_USER, password=SSH_PASSWORD, timeout=30)

def run(cmd, timeout=30):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return stdout.read().decode().strip()

# 查询现有用户的密码 hash
print("查询现有用户 hash:")
result = run(f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} -t -A -F'|' -c \"SELECT username, password_hash FROM users;\"")
print(result)

# 在服务器安装 bcrypt 并生成 hash
print("\n安装 python3-bcrypt 并生成 hash:")
run("pip3 install bcrypt -q 2>/dev/null || apt-get install -y python3-bcrypt -q 2>/dev/null", timeout=60)
hash_result = run("python3 -c \"import bcrypt; h = bcrypt.hashpw(b'test123456', bcrypt.gensalt(10)); print(h.decode())\"", timeout=30)
print(f"生成的 hash: {hash_result!r}")

ssh.close()
