"""部署 api-gateway + Python 爬虫到生产服务器"""
import os
import paramiko

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
REMOTE_DIR = "/opt/snailtrade"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BINARY = os.path.join(ROOT, "backend", "api-gateway", "api-gateway")
MIGRATIONS = os.path.join(ROOT, "backend", "api-gateway", "migrations")
CRAWLER_DIR = os.path.join(ROOT, "data", "crawler")


def upload_dir_recursive(sftp, local_dir, remote_dir, skip_ext=(".pyc", ".egg-info", ".pyo")):
    """递归上传目录，跳过 __pycache__ 和指定扩展名。"""
    for root_dir, dirs, files in os.walk(local_dir):
        # 跳过 __pycache__ 和 .egg-info
        dirs[:] = [d for d in dirs if d != "__pycache__" and not d.endswith(".egg-info")]

        rel = os.path.relpath(root_dir, local_dir)
        if rel == ".":
            target = remote_dir
        else:
            target = f"{remote_dir}/{rel}".replace("\\", "/")

        try:
            sftp.stat(target)
        except FileNotFoundError:
            sftp.mkdir(target)
            print(f"  mkdir {target}")

        for name in files:
            if any(name.endswith(ext) for ext in skip_ext):
                continue
            local_path = os.path.join(root_dir, name)
            remote_path = f"{target}/{name}"
            sftp.put(local_path, remote_path)
            print(f"  uploaded {remote_path}")


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


def deploy_crawler(ssh, sftp):
    """上传并安装 Python 爬虫到服务器。"""
    print("\n--- Python 爬虫部署 ---")

    remote_crawler = f"{REMOTE_DIR}/crawler"

    # 1. 上传爬虫源码
    print("1. Uploading crawler source...")
    try:
        sftp.stat(remote_crawler)
    except FileNotFoundError:
        sftp.mkdir(remote_crawler)
        print(f"  mkdir {remote_crawler}")

    upload_dir_recursive(sftp, CRAWLER_DIR, remote_crawler)

    # 2. 创建日志目录和仓库目录
    print("2. Creating directories...")
    run(ssh, "mkdir -p /var/log/crawler")
    run(ssh, f"mkdir -p {REMOTE_DIR}/warehouse/ohlcv {REMOTE_DIR}/warehouse/snapshots {REMOTE_DIR}/warehouse/reports")

    # 3. 升级 pip 并安装依赖
    print("3. Installing Python dependencies...")
    install_cmds = [
        # 先确保 pip 和 setuptools 最新
        "python3 -m pip install --upgrade pip setuptools wheel -q",
        # 安装爬虫包依赖
        f"cd {remote_crawler} && python3 -m pip install -e . -q",
    ]
    for cmd in install_cmds:
        out = run(ssh, cmd, timeout=120)
        if out:
            print(f"  {out[:200]}")

    print("Python 爬虫部署完成。")


def main():
    if not os.path.isfile(BINARY):
        raise SystemExit(f"Binary not found: {BINARY}. Run go build first.")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

    print("1. Stopping service...")
    print(run(ssh, "systemctl stop snail-api 2>&1; echo stopped"))

    sftp = ssh.open_sftp()

    print("2. Uploading binary...")
    sftp.put(BINARY, f"{REMOTE_DIR}/api-gateway")
    sftp.chmod(f"{REMOTE_DIR}/api-gateway", 0o755)
    print("  api-gateway OK")

    print("3. Uploading migrations...")
    upload_dir(sftp, MIGRATIONS, f"{REMOTE_DIR}/migrations")

    # 4. 部署 Python 爬虫
    deploy_crawler(ssh, sftp)

    sftp.close()

    print("4. Ensuring .env...")
    env_file = f"{REMOTE_DIR}/.env"

    env_settings = {
        "MIGRATIONS_DIR": f"{REMOTE_DIR}/migrations",
        "CRAWLER_SCRIPT_PATH": f"{REMOTE_DIR}/crawler/scripts/cron_collect.py",
        "CRAWLER_PYTHON_BIN": "python3",
        "CHEMBRIDGE_WAREHOUSE": f"{REMOTE_DIR}/warehouse",
    }

    for key, val in env_settings.items():
        has = run(ssh, f"grep -q ^{key}= {env_file} && echo yes || echo no")
        if has == "no":
            run(ssh, f"echo {key}={val} >> {env_file}")
        else:
            # 转义 / 防止 sed 误解
            safe_val = val.replace("/", "\\/")
            run(ssh, f"sed -i 's|^{key}=.*|{key}={safe_val}|' {env_file}")
        print(f"  {key} OK")

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

    import json
    try:
        token = json.loads(login_out)["token"]
        trades_cmd = (
            f"curl -sk 'https://api.snailchemical.com/api/v1/trades?product_id=benzene&limit=5' "
            f"-H 'Authorization: Bearer {token}'"
        )
        trades_out = run(ssh, trades_cmd)
        print("Trades:", "OK" if '"data"' in trades_out else trades_out[:120])
    except Exception as e:
        print("Trades check skipped:", e)

    ssh.close()
    print("\nDeploy complete.")


if __name__ == "__main__":
    main()
