"""验证 migration 021 是否已应用到生产库：检查 trades 表新列"""
import paramiko, os

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

# 读取服务器 .env 中的 DATABASE_URL
_, stdout, _ = ssh.exec_command("grep DATABASE_URL /opt/snailtrade/.env")
dburl = stdout.read().decode().strip().split("=", 1)[-1]

sql = (
    "SELECT column_name, data_type, column_default "
    "FROM information_schema.columns "
    "WHERE table_name='trades' AND column_name IN "
    "('source','buy_serial_no','sell_serial_no','aggressor_user_id',"
    "'delivery_method','free_storage_enabled','buy_specs');"
)
cmd = f'psql "{dburl}" -t -A -F" | " -c "{sql}"'
_, stdout, stderr = ssh.exec_command(cmd, timeout=30)
out = stdout.read().decode().strip()
err = stderr.read().decode().strip()
print("COLUMNS CHECK:")
print(out if out else "(none)")
if err:
    print("ERR:", err)

# 检查是否有历史成交默认 source=auto
cnt_cmd = f'psql "{dburl}" -t -A -c "SELECT count(*) FROM trades;"'
_, stdout, _ = ssh.exec_command(cnt_cmd, timeout=30)
print("trades count:", stdout.read().decode().strip())

ssh.close()
