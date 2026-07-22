"""部署 api-gateway（使用预编译的 Linux binary）到生产服务器"""
import os
import paramiko

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
REMOTE_DIR = "/opt/snailtrade"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BINARY = os.path.join(ROOT, "backend", "api-gateway", "api-gateway-linux")
MIGRATIONS = os.path.join(ROOT, "backend", "api-gateway", "migrations")


def upload_dir(sftp, local_dir, remote_dir):
    try:
        sftp.stat(remote_dir)
    except FileNotFoundError:
        sftp.mkdir(remote_dir)
    for name in os.listdir(local_dir):
        local_path = os.path.join(local_dir, name)
        remote_path = f"{remote_dir}/{name}"
        if os.path.isfile(local_path):
            sftp.put(local_path, remote_path)
            print(f"  uploaded {name}")


def run(ssh, cmd, timeout=30):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    return (out + err).strip()


def main():
    if not os.path.isfile(BINARY):
        raise SystemExit(f"Binary not found: {BINARY}. Cross-compile with GOOS=linux GOARCH=amd64 first.")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

    print("1. Stopping service...")
    print(run(ssh, "systemctl stop snail-api 2>&1; echo stopped"))

    print("2. Uploading binary...")
    sftp = ssh.open_sftp()
    sftp.put(BINARY, f"{REMOTE_DIR}/api-gateway")
    sftp.chmod(f"{REMOTE_DIR}/api-gateway", 0o755)
    print("  api-gateway OK")

    print("3. Uploading migrations...")
    upload_dir(sftp, MIGRATIONS, f"{REMOTE_DIR}/migrations")
    sftp.close()

    print("4. Ensuring .env...")
    has = run(ssh, "grep -q MIGRATIONS_DIR /opt/snailtrade/.env && echo yes || echo no")
    if has == "no":
        run(ssh, "echo MIGRATIONS_DIR=/opt/snailtrade/migrations >> /opt/snailtrade/.env")
    else:
        run(ssh, "sed -i 's|^MIGRATIONS_DIR=.*|MIGRATIONS_DIR=/opt/snailtrade/migrations|' /opt/snailtrade/.env")
    print("  MIGRATIONS_DIR OK")

    print("5. Starting service...")
    run(ssh, "systemctl reset-failed snail-api 2>&1")
    print(run(ssh, "systemctl start snail-api 2>&1; sleep 2; systemctl status snail-api --no-pager 2>&1 | head -8"))

    print("6. Health check...")
    print(run(ssh, "curl -s http://127.0.0.1:8080/health"))

    print("7. API checks...")
    print(run(ssh, "curl -sk https://api.snailchemical.com/api/v1/products 2>&1 | head -c 200"))
    token_cmd = (
        "curl -sk -X POST https://api.snailchemical.com/api/v1/auth/login "
        "-H 'Content-Type: application/json' "
        "-d '{\"username\":\"admin\",\"password\":\"admin123456\"}'"
    )
    login_out = run(ssh, token_cmd)
    print("Login: OK" if '"token"' in login_out else f"Login failed: {login_out[:80]}")

    # 测试新增接口
    print("8. New APIs check...")
    latest_price = run(ssh, "curl -sk 'https://api.snailchemical.com/api/v1/trades/latest-price?product_id=benzene' | head -c 200")
    print("  latest-price:", latest_price[:120])

    price_history = run(ssh, "curl -sk 'https://api.snailchemical.com/api/v1/trades/price-history?product_id=benzene&interval=1h&limit=5' | head -c 200")
    print("  price-history:", price_history[:120])

    ssh.close()
    print("\nBackend deploy complete.")


if __name__ == "__main__":
    main()
