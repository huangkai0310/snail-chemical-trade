import paramiko, json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("115.159.64.125", port=22, username="root", password="Kai&19920310", timeout=30)

def run(cmd):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    return (stdout.read() + stderr.read()).decode().strip()

# Login
login_cmd = """curl -sk -X POST https://api.snailchemical.com/api/v1/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123456"}'"""
login_resp = run(login_cmd)
print("Login:", login_resp[:200])

d = json.loads(login_resp)
tok = d["token"]
print("Token:", tok[:60] + "...")

# Account
acc = run(f'curl -sk -H "Authorization: Bearer {tok}" https://api.snailchemical.com/api/v1/account')
print("Account:", acc)

# Deposit
dep = run(f'curl -sk -X POST -H "Authorization: Bearer {tok}" -H "Content-Type: application/json" -d \'{{"amount":100000,"remark":"test"}}\' https://api.snailchemical.com/api/v1/account/deposit')
print("Deposit:", dep[:300])

# Account again
acc2 = run(f'curl -sk -H "Authorization: Bearer {tok}" https://api.snailchemical.com/api/v1/account')
print("Account after:", acc2)

# Transactions
tx = run(f'curl -sk -H "Authorization: Bearer {tok}" https://api.snailchemical.com/api/v1/account/transactions')
print("TX:", tx[:300])

ssh.close()
