"""验证挂牌状态管理系统的所有功能"""
import paramiko
import json

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

    def run(cmd, timeout=30):
        _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode()
        err = stderr.read().decode()
        return (out + err).strip()

    # 1. 健康检查
    print("=== 1. Health check ===")
    print(run("curl -s http://127.0.0.1:8080/health"))

    # 2. 查看服务状态
    print("\n=== 2. Service status ===")
    print(run("systemctl is-active snail-api"))

    # 3. 查看最近的日志
    print("\n=== 3. Recent logs ===")
    print(run("journalctl -u snail-api -n 15 --no-pager 2>&1"))

    # 4. 验证 listings API - 获取挂牌列表
    print("\n=== 4. Listings API (all listings) ===")
    result = run("curl -sk 'https://api.snailchemical.com/api/v1/listings?limit=5' 2>&1")
    print(result[:500])

    # 5. 验证 listings API - 获取指定品种挂牌
    print("\n=== 5. Listings by product (benzene) ===")
    result = run("curl -sk 'https://api.snailchemical.com/api/v1/listings?product_id=benzene&limit=3' 2>&1")
    print(result[:500])

    # 6. 验证数据库状态分布
    print("\n=== 6. Database status distribution ===")
    db = "postgresql://snailtrade:snailtrade2024@127.0.0.1:5432/snailtrade"
    print(run(f'psql "{db}" -c "SELECT status, COUNT(*) FROM listings GROUP BY status ORDER BY count DESC;"'))

    # 7. 验证 CHECK 约束
    print("\n=== 7. CHECK constraint ===")
    print(run(f"""psql "{db}" -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='listings_status_check';" """))

    ssh.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
