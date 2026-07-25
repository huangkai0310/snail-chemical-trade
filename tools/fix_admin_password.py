#!/usr/bin/env python3
import bcrypt
import psycopg2

conn = psycopg2.connect('postgres://snailtrade:snailtrade2024@127.0.0.1:5432/snailtrade?sslmode=disable')
cur = conn.cursor()
new_password = 'admin123'
hash_str = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt(rounds=10)).decode('utf-8')
cur.execute(
    "UPDATE users SET password_hash = %s, updated_at = NOW() WHERE username = 'admin' RETURNING username, role, status",
    (hash_str,)
)
conn.commit()
result = cur.fetchone()
print('Updated user:', result)
conn.close()
