import subprocess

tests = [
    ('Service', 'systemctl status snail-api --no-pager 2>&1 | head -5'),
    ('Products', 'curl -sk https://api.snailchemical.com/api/v1/products 2>&1 | head -5'),
    ('Login', "curl -sk -X POST https://api.snailchemical.com/api/v1/auth/login -H 'Content-Type: application/json' -d '{\"username\":\"admin\",\"password\":\"admin123456\"}' 2>&1"),
    ('Process', 'ps aux | grep api-gateway | grep -v grep'),
]

for name, cmd in tests:
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
    print(f"=== {name} ===")
    print(r.stdout[:500] or r.stderr[:300])
    print()
