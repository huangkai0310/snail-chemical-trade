package config

import (
	"log"
	"os"
)

type Config struct {
	Port          string
	DatabaseURL   string
	JWTSecret     string
	RedisAddr     string
	MigrationsDir string
}

func Load() *Config {
	jwtSecret := getEnv("JWT_SECRET", "")
	if jwtSecret == "" {
		log.Fatal("JWT_SECRET 环境变量未设置，拒绝启动（请设置一个随机密钥）")
	}

	return &Config{
		Port:          getEnv("PORT", "8080"),
		DatabaseURL:   getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/snailtrade?sslmode=disable"),
		JWTSecret:     jwtSecret,
		RedisAddr:     getEnv("REDIS_ADDR", "localhost:6379"),
		MigrationsDir: getEnv("MIGRATIONS_DIR", ""),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
