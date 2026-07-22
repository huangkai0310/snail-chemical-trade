#!/usr/bin/env python3
import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("115.159.64.125", username="root", password="Kai&19920310", timeout=30)

def run(c):
    _, o, e = ssh.exec_command(c, timeout=60)
    return (o.read() + e.read()).decode("utf-8", errors="replace")

print(run("systemctl is-active snail-api"))
print(run("curl -s http://127.0.0.1:8080/health"))
print(run("journalctl -u snail-api --since '15 min ago' --no-pager 2>&1 | grep -iE 'panic|fatal|error|502|OOM' | tail -30"))
print(run("free -m | head -3"))
ssh.close()
