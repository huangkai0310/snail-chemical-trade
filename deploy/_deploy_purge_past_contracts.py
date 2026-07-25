"""Deploy past-delivery contract purge cron (API only)."""
import os
import sys

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
REMOTE_DIR = "/opt/snailtrade"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BINARY = os.path.join(ROOT, "backend", "api-gateway", "api-gateway-linux")
MIGRATIONS = os.path.join(ROOT, "backend", "api-gateway", "migrations")


def run(ssh, cmd, timeout=120):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return (stdout.read() + stderr.read()).decode(errors="replace").strip()


def main():
    if not os.path.isfile(BINARY):
        raise SystemExit(f"Binary not found: {BINARY}")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    sftp = ssh.open_sftp()

    print("1. Stop + upload binary...")
    print(run(ssh, "systemctl stop snail-api 2>&1; echo stopped"))
    sftp.put(BINARY, f"{REMOTE_DIR}/api-gateway")
    sftp.chmod(f"{REMOTE_DIR}/api-gateway", 0o755)

    print("2. Upload migrations...")
    for name in os.listdir(MIGRATIONS):
        if name.endswith(".sql"):
            sftp.put(os.path.join(MIGRATIONS, name), f"{REMOTE_DIR}/migrations/{name}")
    sftp.close()

    print("3. Start API (runs migrations)...")
    print(run(ssh, "systemctl reset-failed snail-api; systemctl start snail-api; sleep 3; systemctl is-active snail-api; curl -s http://127.0.0.1:8080/health"))

    print("4. Ensure cron task + force last_run null so it runs soon...")
    print(run(ssh, r"""
cd /opt/snailtrade
DBURL=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")
psql "$DBURL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO cron_tasks (name, description, task_type, interval_seconds, enabled)
VALUES (
    'purge_past_contracts',
    '清除交割日已过的非现货合约（并清理自选）',
    'interval',
    86400,
    true
)
ON CONFLICT (name) DO UPDATE SET enabled = true, interval_seconds = 86400,
  description = EXCLUDED.description;

UPDATE cron_tasks SET last_run_at = NULL WHERE name = 'purge_past_contracts';
SELECT name, enabled, interval_seconds, last_run_at FROM cron_tasks WHERE name = 'purge_past_contracts';
SQL
"""))

    print("5. Wait for scheduler tick (~35s) then check contracts/logs...")
    print(run(ssh, "sleep 35; journalctl -u snail-api --since '2 min ago' --no-pager 2>&1 | grep -E '交割已过|purge_past|定时任务' | tail -20"))
    print("acetone contracts:", run(ssh, "curl -sk https://api.snailchemical.com/api/v1/products/acetone/contracts 2>&1 | head -c 500"))
    ssh.close()
    print("Done.")


if __name__ == "__main__":
    main()
