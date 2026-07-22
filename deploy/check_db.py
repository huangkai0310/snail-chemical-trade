"""查看数据库中 listings 表的实际数据状态"""
import paramiko

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

    db = "postgresql://snailtrade:snailtrade2024@127.0.0.1:5432/snailtrade"

    print("=== listings status distribution ===")
    print(run(f'psql "{db}" -c "SELECT status, COUNT(*) FROM listings GROUP BY status ORDER BY status;"'))

    print("\n=== Current CHECK constraints on listings ===")
    print(run(f"""psql "{db}" -c "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='listings'::regclass AND contype='c';" """))

    print("\n=== listings table DDL ===")
    print(run(f'psql "{db}" -c "\\d listings"'))

    print("\n=== migration_history ===")
    print(run(f'psql "{db}" -c "SELECT * FROM schema_migrations ORDER BY version;" 2>&1'))
    print(run(f'psql "{db}" -c "SELECT * FROM migrations ORDER BY applied_at;" 2>&1'))
    print(run(f'psql "{db}" -c "\\dt" 2>&1'))

    ssh.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
