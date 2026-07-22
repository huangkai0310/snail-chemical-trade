"""Debug backend 502 - check service logs"""
import paramiko

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

    def run(cmd, timeout=30):
        _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode()
        err = stderr.read().decode()
        return (out + err).strip()

    print("=== Service Status ===")
    print(run("systemctl status snail-api --no-pager 2>&1"))

    print("\n=== Last 80 journal lines ===")
    print(run("journalctl -u snail-api -n 80 --no-pager 2>&1"))

    print("\n=== .env file ===")
    print(run("cat /opt/snailtrade/.env 2>&1"))

    print("\n=== Binary info ===")
    print(run("file /opt/snailtrade/api-gateway 2>&1"))
    print(run("ls -la /opt/snailtrade/api-gateway 2>&1"))

    print("\n=== Migrations dir ===")
    print(run("ls -la /opt/snailtrade/migrations/ 2>&1"))

    print("\n=== Service file ===")
    print(run("cat /etc/systemd/system/snail-api.service 2>&1"))

    print("\n=== Try running binary directly ===")
    print(run("cd /opt/snailtrade && timeout 5 ./api-gateway 2>&1 || true"))

    ssh.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
