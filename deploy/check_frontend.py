import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('115.159.64.125', port=22, username='root', password='Kai&19920310', timeout=30)

cmds = [
    ('web service', 'systemctl is-active snail-web'),
    ('homepage', "curl -sk -o /dev/null -w '%{http_code}' https://trade.snailchemical.com/"),
    ('api proxy', "curl -sk -o /dev/null -w '%{http_code}' https://trade.snailchemical.com/api/v1/products"),
    ('register', """curl -sk -X POST https://trade.snailchemical.com/api/v1/auth/register -H 'Content-Type: application/json' -d '{"username":"test_check_user","password":"test123456"}' -w '\\n%{http_code}' | tail -1"""),
    ('login', """curl -sk -X POST https://trade.snailchemical.com/api/v1/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123456"}' -w '\\n%{http_code}' | tail -1"""),
    ('page title', "curl -sk https://trade.snailchemical.com/ 2>&1 | grep -o '<title>[^<]*</title>' | head -1"),
    ('has auth ui', "curl -sk https://trade.snailchemical.com/ 2>&1 | grep -c '登录' || true"),
]

for name, cmd in cmds:
    _, stdout, _ = ssh.exec_command(cmd, timeout=20)
    print(f"{name}: {stdout.read().decode().strip()}")

ssh.close()
