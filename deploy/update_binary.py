import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('115.159.64.125', port=22, username='root', password='Kai&19920310', timeout=30)

# 1. Stop service
stdin, stdout, stderr = ssh.exec_command('systemctl stop snail-api 2>&1 && echo stopped', timeout=10)
print('1. Stop:', stdout.read().decode().strip())

# 2. Upload new binary
sftp = ssh.open_sftp()
src = r'D:\BaiduSyncdisk\WorkBuddy\2026-06-24-10-17-17\backend\api-gateway\api-gateway'
sftp.put(src, '/opt/snailtrade/api-gateway')
sftp.chmod('/opt/snailtrade/api-gateway', 0o755)
sftp.close()
print('2. Binary uploaded')

# 3. Update .env - add/update MIGRATIONS_DIR
stdin, stdout, stderr = ssh.exec_command("grep -q MIGRATIONS_DIR /opt/snailtrade/.env && echo exists || echo missing", timeout=5)
has_migrations = stdout.read().decode().strip() == 'exists'

if not has_migrations:
    stdin, stdout, stderr = ssh.exec_command("echo MIGRATIONS_DIR=/opt/snailtrade/migrations >> /opt/snailtrade/.env && echo added", timeout=5)
    print('3. .env:', stdout.read().decode().strip())
else:
    stdin, stdout, stderr = ssh.exec_command("sed -i 's|^MIGRATIONS_DIR=.*|MIGRATIONS_DIR=/opt/snailtrade/migrations|' /opt/snailtrade/.env && echo updated", timeout=5)
    print('3. .env:', stdout.read().decode().strip())

# 4. Verify .env
stdin, stdout, stderr = ssh.exec_command('cat /opt/snailtrade/.env', timeout=5)
print('4. .env content:')
print(stdout.read().decode())

# 5. Start service
stdin, stdout, stderr = ssh.exec_command('systemctl reset-failed snail-api 2>&1; systemctl start snail-api 2>&1; sleep 2; systemctl status snail-api --no-pager 2>&1 | head -6', timeout=15)
print('5. Status:')
print(stdout.read().decode())

ssh.close()
