package db

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"

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

// RunMigrations 执行 SQL 迁移文件（按文件名排序，已应用的跳过）
func RunMigrations(pool *pgxpool.Pool, migrationsDir string) error {
	if migrationsDir == "" {
		if d := os.Getenv("MIGRATIONS_DIR"); d != "" {
			migrationsDir = d
		} else {
			exe, _ := os.Executable()
			migrationsDir = filepath.Join(filepath.Dir(exe), "migrations")
		}
	}

	ctx := context.Background()

	// 迁移跟踪表：防止每次重启重复执行非幂等 SQL（如 UPDATE 改写业务数据）
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename   TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}

	var names []string
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" {
			continue
		}
		names = append(names, entry.Name())
	}
	sort.Strings(names)

	applied := map[string]bool{}
	rows, err := pool.Query(ctx, `SELECT filename FROM schema_migrations`)
	if err != nil {
		return fmt.Errorf("list schema_migrations: %w", err)
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return err
		}
		applied[name] = true
	}
	rows.Close()

	// 首次引入跟踪表：若表为空但库已有业务表，视为历史迁移均已应用，只登记不重跑，
	// 避免再次执行已「消化完」的破坏性 UPDATE（如旧版 009）。
	if len(applied) == 0 {
		var hasListings bool
		_ = pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM information_schema.tables
				WHERE table_schema = 'public' AND table_name = 'listings'
			)`).Scan(&hasListings)
		if hasListings {
			for _, name := range names {
				if _, err := pool.Exec(ctx,
					`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, name,
				); err != nil {
					return fmt.Errorf("bootstrap mark %s: %w", name, err)
				}
				applied[name] = true
			}
			log.Info().Int("count", len(names)).Msg("schema_migrations bootstrapped for existing database")
		}
	}

	for _, name := range names {
		if applied[name] {
			log.Debug().Str("file", name).Msg("migration already applied, skip")
			continue
		}

		path := filepath.Join(migrationsDir, name)
		sql, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}

		log.Info().Str("file", name).Msg("running migration")
		tx, err := pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("execute %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO schema_migrations (filename) VALUES ($1)`, name,
		); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record %s: %w", name, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit %s: %w", name, err)
		}
	}

	log.Info().Msg("Migrations complete")
	return nil
}
