"""本地测试：只生成 SQL 文件，不连接服务器"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import random
random.seed(2026)

# 直接 import 生成函数
import importlib.util
spec = importlib.util.spec_from_file_location("seed", os.path.join(os.path.dirname(__file__), "seed_test_data.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

print("生成 SQL 中...")
sql = mod.generate_sql()

out_path = os.path.join(os.path.dirname(__file__), "seed_test_data.sql")
with open(out_path, "w", encoding="utf-8") as f:
    f.write(sql)
size = os.path.getsize(out_path) / 1024 / 1024
print(f"SQL 文件大小: {size:.2f} MB")

# 简单检查
lines = sql.split("\n")
print(f"总行数: {len(lines)}")
# 统计各 INSERT 类型
import re
counters = {}
for l in lines:
    m = re.match(r"INSERT INTO (\w+)", l)
    if m:
        t = m.group(1)
        counters[t] = counters.get(t, 0) + 1
print("INSERT 语句分布:")
for t, c in sorted(counters.items()):
    print(f"  {t}: {c} 批次")

# 检查 swap_listings INSERT 的列数
print("\n--- swap_listings INSERT 样本 ---")
in_swap = False
for l in lines:
    if "INSERT INTO swap_listings" in l:
        in_swap = True
        print(l[:200])
    elif in_swap:
        # 打印第一行数据
        print(l[:300])
        break
