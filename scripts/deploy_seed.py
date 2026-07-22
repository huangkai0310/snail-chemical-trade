"""
执行前：先在服务器上生成正确的 bcrypt hash，然后运行完整的 seed
"""
import paramiko
import random
import os
import io

HOST = "115.159.64.125"
SSH_USER = "root"
SSH_PASSWORD = "Kai&19920310"
DB_USER = "snailtrade"
DB_PASS = "snailtrade2024"
DB_NAME = "snailtrade"

def run_ssh(ssh, cmd, timeout=300):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if err and "NOTICE" not in err and "WARNING" not in err:
        print(f"  [stderr] {err[:300]}")
    return out

def main():
    print("连接服务器...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=SSH_USER, password=SSH_PASSWORD, timeout=30)

    # Step 1: 在服务器生成正确的 bcrypt hash
    print("在服务器生成正确的 bcrypt hash...")
    hash_result = run_ssh(ssh, (
        "python3 -c \""
        "import bcrypt; "
        "h = bcrypt.hashpw(b'test123456', bcrypt.gensalt(rounds=10)); "
        "print(h.decode())"
        "\""
    ), timeout=15)
    print(f"生成的 hash: {hash_result}")

    # Step 2: 更新本地 SQL 文件中的 hash
    sql_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_test_data.sql")
    with open(sql_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    old_hash = "$2a$10$YK3m4G2xOOaqp0TpyW4G1.PLiqb0yp1HcMx0Xu.ZrCVrODe9DWMaO"
    if hash_result and hash_result.startswith("$2b$"):
        new_content = content.replace(old_hash, hash_result)
        with open(sql_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        print(f"已更新 SQL 文件中的 hash")
    else:
        print(f"警告：hash 生成结果不正常: {hash_result!r}")
        print("继续使用旧的 hash...")

    # Step 3: 上传 SQL 文件
    print(f"上传 SQL 文件...")
    sftp = ssh.open_sftp()
    remote_sql = "/tmp/seed_v2.sql"
    sftp.put(sql_path, remote_sql)
    sftp.close()

    # Step 4: 执行 SQL
    print("执行 SQL（约 1-3 分钟）...")
    result = run_ssh(ssh, (
        f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} "
        f"-f {remote_sql} 2>&1"
    ), timeout=600)

    lines_out = [l for l in result.split("\n") if l.strip()]
    for line in lines_out[-30:]:
        stripped = line.strip()
        if stripped and "INSERT" not in stripped:
            print(f"  {stripped}")

    # Step 5: 验证数据量
    print("\n验证数据量...")
    tables = ["users","accounts","listings","trades","swap_listings","swap_matches","margin_holds"]
    for tbl in tables:
        cnt = run_ssh(ssh, (
            f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} "
            f"-t -c \"SELECT COUNT(*) FROM {tbl}\""
        ), timeout=15)
        print(f"  {tbl:<20}: {cnt.strip():>8} 行")

    # Step 6: 验证密码
    print("\n验证登录密码...")
    verify = run_ssh(ssh, (
        f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} "
        f"-t -c \"SELECT username, LEFT(password_hash,10) FROM users WHERE username IN ('admin','trader_zhang')\""
    ), timeout=15)
    print(f"  {verify}")

    # Step 7: 重启后端
    print("重启后端服务（重载订单簿）...")
    run_ssh(ssh, "systemctl restart snail-api", timeout=30)
    import time
    time.sleep(4)
    health = run_ssh(ssh, "curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/health 2>/dev/null", timeout=15)
    print(f"  后端健康检查: {health}")

    # 换盘数量验证
    swaps = run_ssh(ssh, (
        f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} "
        f"-t -A -F'|' -c "
        f"\"SELECT sell_product_id, buy_product_id, allow_partial, sell_filled FROM swap_listings ORDER BY created_at DESC LIMIT 8;\""
    ), timeout=15)
    print("\n换盘挂牌样本（前8条）:")
    for line in swaps.strip().split("\n"):
        if "|" in line:
            parts = line.split("|")
            ap = "可拆" if len(parts)>2 and parts[2]=="t" else "不可拆"
            prog = f"进度:{parts[3]}" if len(parts)>3 and parts[3]!="0.00" else "未还盘"
            print(f"  {(parts[0] if parts else ''):<14} → {(parts[1] if len(parts)>1 else ''):<14} [{ap}] [{prog}]")

    run_ssh(ssh, f"rm -f {remote_sql}", timeout=10)
    ssh.close()
    print("\n✅ 完成！")
    print("访问: https://trade.snailchemical.com")
    print("密码: test123456")

if __name__ == "__main__":
    main()
