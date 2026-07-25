package config

import (
	"log"
	"os"
)

type Config struct {
	Port              string
	DatabaseURL       string
	JWTSecret         string
	RedisAddr         string
	MigrationsDir     string
	CrawlerScriptPath string // Python 爬虫入口脚本路径（如 /opt/snailtrade/crawler/scripts/cron_collect.py）
	CrawlerPythonBin  string // Python 解释器路径（如 python3）
}

func Load() *Config {
	jwtSecret := getEnv("JWT_SECRET", "")
	if jwtSecret == "" {
		log.Fatal("JWT_SECRET 环境变量未设置，拒绝启动（请设置一个随机密钥）")
	}

	return &Config{
		Port:              getEnv("PORT", "8080"),
		DatabaseURL:       getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/snailtrade?sslmode=disable"),
		JWTSecret:         jwtSecret,
		RedisAddr:         getEnv("REDIS_ADDR", "localhost:6379"),
		MigrationsDir:     getEnv("MIGRATIONS_DIR", ""),
		CrawlerScriptPath: getEnv("CRAWLER_SCRIPT_PATH", ""),
		CrawlerPythonBin:  getEnv("CRAWLER_PYTHON_BIN", "python3"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
