package config

import "os"

type Config struct {
	Port        string
	DatabaseURL string
	JWTSecret   string
	RedisAddr   string
}

func Load() *Config {
	return &Config{
		Port:        getEnv("PORT", "8080"),
		DatabaseURL: getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/snailtrade?sslmode=disable"),
		JWTSecret:   getEnv("JWT_SECRET", "snail-chemical-trade-dev-secret"),
		RedisAddr:   getEnv("REDIS_ADDR", "localhost:6379"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
