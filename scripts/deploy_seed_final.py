"""
完整的部署脚本：使用正确的 bcrypt hash，上传并执行 SQL
"""
import paramiko
import os
import time

HOST = "115.159.64.125"
SSH_USER = "root"
SSH_PASSWORD = "Kai&19920310"
DB_USER = "snailtrade"
DB_PASS = "snailtrade2024"
DB_NAME = "snailtrade"

# 正确的 bcrypt hash（已在服务器上验证 test123456 可匹配）
CORRECT_HASH = "$2b$10$Sxciy3W2XePSURs850uOvewjCPExQf.m0SdmLrFeXjaofKxfWbvca"

def run_ssh(ssh, cmd, timeout=300):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    return out, err

def main():
    print("=" * 60)
    print("Snail Chemical Trade - 测试数据生成器 v2")
    print("=" * 60)

    # Step 1: 更新 SQL 文件中的 hash
    sql_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_test_data.sql")
    with open(sql_path, "r", encoding="utf-8") as f:
        content = f.read()

    # 替换所有 hash
    # 旧 hash: $2a$10$YK3m4G2xOOaqp0TpyW4G1.PLiqb0yp1HcMx0Xu.ZrCVrODe9DWMaO
    # 新 hash: $2b$10$Sxciy3W2XePSURs850uOvewjCPExQf.m0SdmLrFeXjaofKxfWbvca
    old_hash1 = "$2a$10$YK3m4G2xOOaqp0TpyW4G1.PLiqb0yp1HcMx0Xu.ZrCVrODe9DWMaO"
    content = content.replace(old_hash1, CORRECT_HASH)
    
    # 如果有任何其他旧 hash 格式也替换
    # 找出所有 password_hash 值并替换
    import re
    # 替换 INSERT 语句中的 hash
    content = re.sub(
        r"'\$2[aby]\$10\$[A-Za-z0-9./]{53}'",
        f"'{CORRECT_HASH}'",
        content
    )
    
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write(content)
    
    # 验证
    hash_count = content.count(CORRECT_HASH)
    print(f"[1/5] SQL 文件已更新，包含 {hash_count} 个正确 hash")
    print(f"      Hash: {CORRECT_HASH}")

    # Step 2: 连接服务器
    print("\n[2/5] 连接服务器...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=SSH_USER, password=SSH_PASSWORD, timeout=30)

    # Step 3: 上传 SQL 文件
    print("[3/5] 上传 SQL 文件...")
    sftp = ssh.open_sftp()
    remote_sql = "/tmp/seed_v2_final.sql"
    sftp.put(sql_path, remote_sql)
    sql_size = os.path.getsize(sql_path) / 1024 / 1024
    sftp.close()
    print(f"      已上传 {sql_size:.2f} MB")

    # Step 4: 执行 SQL
    print("[4/5] 执行 SQL（约 1-3 分钟）...")
    cmd = f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} -f {remote_sql} 2>&1"
    result, err = run_ssh(ssh, cmd, timeout=600)
    
    # 打印结果（只显示最后 40 行）
    lines = [l for l in result.split("\n") if l.strip()]
    print(f"      执行完成，输出 {len(lines)} 行")
    
    # 检查是否有 ROLLBACK
    has_rollback = any("ROLLBACK" in l for l in lines)
    has_error = any("ERROR" in l.upper() for l in lines)
    
    if has_rollback or has_error:
        print("\n  ⚠️ 检测到错误或 ROLLBACK：")
        for l in lines:
            if "ERROR" in l.upper() or "ROLLBACK" in l:
                print(f"  {l}")
        # 打印错误行前后上下文
        for i, l in enumerate(lines):
            if "ERROR" in l.upper():
                start = max(0, i-2)
                end = min(len(lines), i+3)
                print(f"\n  --- 上下文 ---")
                for j in range(start, end):
                    marker = ">>>" if j == i else "   "
                    print(f"  {marker} {lines[j][:200]}")
    
    # 显示统计结果
    print("\n  统计结果:")
    for l in lines[-30:]:
        s = l.strip()
        if s and "INSERT" not in s and "TRUNCATE" not in s and "DELETE" not in s and "BEGIN" not in s and "COMMIT" not in s:
            print(f"  {s}")

    # Step 5: 验证数据量
    print("\n[5/5] 验证数据量...")
    tables = ["users","accounts","transactions","listings","trades","swap_listings","swap_matches","margin_holds"]
    for tbl in tables:
        cnt, _ = run_ssh(ssh, (
            f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} "
            f"-t -c \"SELECT COUNT(*) FROM {tbl}\""
        ), timeout=15)
        print(f"  {tbl:<20}: {cnt.strip():>8} 行")

    # 验证密码登录
    print("\n验证密码 hash:")
    hash_check, _ = run_ssh(ssh, (
        f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} "
        f"-t -A -c \"SELECT username, LEFT(password_hash,15) FROM users LIMIT 3\""
    ), timeout=15)
    print(f"  {hash_check}")

    # 换盘数据样本
    print("\n换盘挂牌样本:")
    swaps, _ = run_ssh(ssh, (
        f"PGPASSWORD={DB_PASS} psql -U {DB_USER} -h 127.0.0.1 -d {DB_NAME} "
        f"-t -A -F'|' -c "
        f"\"SELECT sell_product_id, buy_product_id, allow_partial, sell_filled, buy_filled "
        f"FROM swap_listings WHERE status='OPEN' ORDER BY created_at DESC LIMIT 8;\""
    ), timeout=15)
    for line in swaps.strip().split("\n"):
        if "|" in line:
            parts = line.split("|")
            ap = "可拆" if len(parts)>2 and parts[2]=="t" else "不可拆"
            sf = parts[3] if len(parts)>3 else "0"
            bf = parts[4] if len(parts)>4 else "0"
            prog = f"卖腿:{sf} 买腿:{bf}" if sf != "0.00" else "未还盘"
            print(f"  {(parts[0] if parts else ''):<14} → {(parts[1] if len(parts)>1 else ''):<14} [{ap}] [{prog}]")

    # 重启后端
    print("\n重启后端服务...")
    run_ssh(ssh, "systemctl restart snail-api", timeout=30)
    time.sleep(4)
    health, _ = run_ssh(ssh, "curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/health 2>/dev/null", timeout=15)
    print(f"  后端健康检查: {health}")

    # 测试登录
    print("\n测试登录...")
    login_resp, _ = run_ssh(ssh, (
        "curl -s -X POST http://localhost:8080/api/v1/auth/login "
        "-H 'Content-Type: application/json' "
        "-d '{\"username\":\"admin\",\"password\":\"test123456\"}'"
    ), timeout=15)
    if "token" in login_resp.lower():
        print("  ✅ admin 登录成功")
    else:
        print(f"  ❌ admin 登录失败: {login_resp[:200]}")

    # 清理
    run_ssh(ssh, f"rm -f {remote_sql}", timeout=10)
    ssh.close()

    print("\n" + "=" * 60)
    print("✅ 测试数据生成完成！")
    print(f"   访问: https://trade.snailchemical.com")
    print(f"   密码: test123456")
    print(f"   用户: admin, trader_zhang, trader_li, trader_wang, trader_chen, trader_zhao")
    print("=" * 60)

if __name__ == "__main__":
    main()
