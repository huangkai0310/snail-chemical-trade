import paramiko
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

    def run(cmd, timeout=60):
        _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
        return (stdout.read() + stderr.read()).decode(errors="replace").strip()

    print("OPTIONS:")
    print(run(
        "curl -sk -D- -o /dev/null -X OPTIONS "
        "https://api.snailchemical.com/api/v1/admin/market-config "
        "-H 'Origin: https://trade.snailchemical.com' "
        "-H 'Access-Control-Request-Method: GET' "
        "-H 'Access-Control-Request-Headers: authorization,content-type'"
    ))
    print("GET:")
    print(run(
        "curl -sk -D- -o /tmp/b.json "
        "-H 'Origin: https://trade.snailchemical.com' "
        "-H 'Authorization: Bearer x' "
        "https://api.snailchemical.com/api/v1/admin/market-config"
    ))
    print("BODY:", run("cat /tmp/b.json"))
    print("STATUS:", run("curl -sk https://api.snailchemical.com/api/v1/market-status"))
    ssh.close()


if __name__ == "__main__":
    main()
