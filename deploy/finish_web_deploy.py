"""等待服务器构建完成并启动前端服务"""
import time
import paramiko

HOST = "115.159.64.125"
USER = "root"
PASSWORD = "Kai&19920310"
REMOTE_SRC = "/opt/snailtrade/web-src"
REMOTE_WEB = "/opt/snailtrade/web"


def run(ssh, cmd, timeout=900):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return (stdout.read() + stderr.read()).decode().strip()


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=30)

    # 若构建未在跑，启动后台构建
    running = run(ssh, "pgrep -f 'npm (install|run build)' >/dev/null && echo yes || echo no")
    standalone = f"{REMOTE_SRC}/.next/standalone/server.js"
    has_build = run(ssh, f"test -f {standalone} && echo yes || echo no")

    if has_build != "yes" and running != "yes":
        print("Starting background build...")
        run(ssh, f"cd {REMOTE_SRC} && nohup bash -c 'npm install && npm run build' > /opt/snailtrade/logs/web-build.log 2>&1 &")

    print("Waiting for build...")
    for i in range(60):
        has_build = run(ssh, f"test -f {standalone} && echo yes || echo no")
        if has_build == "yes":
            print(f"Build ready after {i * 15}s")
            break
        tail = run(ssh, "tail -3 /opt/snailtrade/logs/web-build.log 2>/dev/null || tail -3 /root/.npm/_logs/*.log 2>/dev/null | tail -3")
        print(f"  [{i*15}s] waiting... {tail[:120]}")
        time.sleep(15)
    else:
        print("Build timeout. Log tail:")
        print(run(ssh, "tail -30 /opt/snailtrade/logs/web-build.log 2>/dev/null"))
        ssh.close()
        raise SystemExit(1)

    print("Preparing runtime...")
    run(ssh, f"""
        systemctl stop snail-web 2>/dev/null || true
        rm -rf {REMOTE_WEB}
        mkdir -p {REMOTE_WEB}
        cp -a {REMOTE_SRC}/.next/standalone/. {REMOTE_WEB}/
        mkdir -p {REMOTE_WEB}/.next
        cp -a {REMOTE_SRC}/.next/static {REMOTE_WEB}/.next/
        test -d {REMOTE_SRC}/public && cp -a {REMOTE_SRC}/public {REMOTE_WEB}/ || true
        ls -la {REMOTE_WEB}/server.js
    """)

    print("Starting snail-web...")
    run(ssh, "systemctl restart snail-web")
    time.sleep(3)
    print(run(ssh, "systemctl status snail-web --no-pager 2>&1 | head -8"))

    local = run(ssh, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/")
    public = run(ssh, "curl -sk -o /dev/null -w '%{http_code}' https://trade.snailchemical.com/")
    print(f"Health: local={local}, public={public}")

    ssh.close()
    if local == "200":
        print("\nDone: https://trade.snailchemical.com")
    else:
        print("\nService may need attention. Check /opt/snailtrade/logs/web-error.log")


if __name__ == "__main__":
    main()
