package db

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

var Pool *pgxpool.Pool

// Connect 创建 PostgreSQL 连接池
func Connect(databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse db config: %w", err)
	}

	cfg.MaxConns = 20
	cfg.MinConns = 2

	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}

	log.Info().Msg("PostgreSQL connected")
	Pool = pool
	return pool, nil
}

// RunMigrations 执行 SQL 迁移文件
func RunMigrations(pool *pgxpool.Pool, migrationsDir string) error {
	if migrationsDir == "" {
		// 默认从 api-gateway/migrations/ 目录加载
		_, f, _, _ := runtime.Caller(0)
		migrationsDir = filepath.Join(filepath.Dir(f), "..", "migrations")
	}

	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" {
			continue
		}

		path := filepath.Join(migrationsDir, entry.Name())
		sql, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read %s: %w", entry.Name(), err)
		}

		log.Info().Str("file", entry.Name()).Msg("running migration")
		if _, err := pool.Exec(context.Background(), string(sql)); err != nil {
			return fmt.Errorf("execute %s: %w", entry.Name(), err)
		}
	}

	log.Info().Msg("Migrations complete")
	return nil
}
