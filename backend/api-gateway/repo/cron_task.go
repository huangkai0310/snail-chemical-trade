package repo

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CronTask 定时任务配置
type CronTask struct {
	ID              int        `json:"id"`
	Name            string     `json:"name"`
	Description     string     `json:"description"`
	TaskType        string     `json:"task_type"` // "interval" 或 "cron"
	IntervalSeconds *int       `json:"interval_seconds,omitempty"`
	CronExpr        *string    `json:"cron_expr,omitempty"`
	Enabled         bool       `json:"enabled"`
	LastRunAt       *time.Time `json:"last_run_at,omitempty"`
	LastStatus      string     `json:"last_status"`
	LastMessage     *string    `json:"last_message,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// CronTaskRepo 定时任务数据访问层
type CronTaskRepo struct {
	pool *pgxpool.Pool
}

func NewCronTaskRepo(pool *pgxpool.Pool) *CronTaskRepo {
	return &CronTaskRepo{pool: pool}
}

// List 查询全部定时任务
func (r *CronTaskRepo) List(ctx context.Context) ([]CronTask, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, name, description, task_type, interval_seconds, cron_expr, enabled,
		        last_run_at, last_status, last_message, created_at, updated_at
		 FROM cron_tasks ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []CronTask
	for rows.Next() {
		var t CronTask
		if err := rows.Scan(&t.ID, &t.Name, &t.Description, &t.TaskType, &t.IntervalSeconds,
			&t.CronExpr, &t.Enabled, &t.LastRunAt, &t.LastStatus, &t.LastMessage,
			&t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, t)
	}
	return items, rows.Err()
}

// ListEnabled 查询已启用的定时任务
func (r *CronTaskRepo) ListEnabled(ctx context.Context) ([]CronTask, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, name, description, task_type, interval_seconds, cron_expr, enabled,
		        last_run_at, last_status, last_message, created_at, updated_at
		 FROM cron_tasks WHERE enabled = true ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []CronTask
	for rows.Next() {
		var t CronTask
		if err := rows.Scan(&t.ID, &t.Name, &t.Description, &t.TaskType, &t.IntervalSeconds,
			&t.CronExpr, &t.Enabled, &t.LastRunAt, &t.LastStatus, &t.LastMessage,
			&t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, t)
	}
	return items, rows.Err()
}

// GetByID 按 ID 查询
func (r *CronTaskRepo) GetByID(ctx context.Context, id int) (*CronTask, error) {
	t := &CronTask{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, name, description, task_type, interval_seconds, cron_expr, enabled,
		        last_run_at, last_status, last_message, created_at, updated_at
		 FROM cron_tasks WHERE id = $1`, id,
	).Scan(&t.ID, &t.Name, &t.Description, &t.TaskType, &t.IntervalSeconds,
		&t.CronExpr, &t.Enabled, &t.LastRunAt, &t.LastStatus, &t.LastMessage,
		&t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return t, nil
}

// GetByName 按名称查询
func (r *CronTaskRepo) GetByName(ctx context.Context, name string) (*CronTask, error) {
	t := &CronTask{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, name, description, task_type, interval_seconds, cron_expr, enabled,
		        last_run_at, last_status, last_message, created_at, updated_at
		 FROM cron_tasks WHERE name = $1`, name,
	).Scan(&t.ID, &t.Name, &t.Description, &t.TaskType, &t.IntervalSeconds,
		&t.CronExpr, &t.Enabled, &t.LastRunAt, &t.LastStatus, &t.LastMessage,
		&t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return t, nil
}

// Create 创建定时任务
func (r *CronTaskRepo) Create(ctx context.Context, name, description, taskType string, intervalSeconds *int, cronExpr *string, enabled bool) (*CronTask, error) {
	t := &CronTask{}
	err := r.pool.QueryRow(ctx,
		`INSERT INTO cron_tasks (name, description, task_type, interval_seconds, cron_expr, enabled)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, name, description, task_type, interval_seconds, cron_expr, enabled,
		           last_run_at, last_status, last_message, created_at, updated_at`,
		name, description, taskType, intervalSeconds, cronExpr, enabled,
	).Scan(&t.ID, &t.Name, &t.Description, &t.TaskType, &t.IntervalSeconds,
		&t.CronExpr, &t.Enabled, &t.LastRunAt, &t.LastStatus, &t.LastMessage,
		&t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return t, nil
}

// Update 更新定时任务配置（不含运行状态）
func (r *CronTaskRepo) Update(ctx context.Context, id int, name, description, taskType string, intervalSeconds *int, cronExpr *string, enabled bool) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE cron_tasks SET name = $1, description = $2, task_type = $3,
		        interval_seconds = $4, cron_expr = $5, enabled = $6, updated_at = NOW()
		 WHERE id = $7`,
		name, description, taskType, intervalSeconds, cronExpr, enabled, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete 删除定时任务
func (r *CronTaskRepo) Delete(ctx context.Context, id int) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM cron_tasks WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateRunStatus 更新运行状态（任务执行后调用）
func (r *CronTaskRepo) UpdateRunStatus(ctx context.Context, name, status, message string) error {
	now := time.Now()
	_, err := r.pool.Exec(ctx,
		`UPDATE cron_tasks SET last_run_at = $1, last_status = $2, last_message = $3, updated_at = NOW()
		 WHERE name = $4`,
		now, status, message, name)
	return err
}

// ToggleEnabled 启用/禁用定时任务
func (r *CronTaskRepo) ToggleEnabled(ctx context.Context, id int, enabled bool) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE cron_tasks SET enabled = $1, updated_at = NOW() WHERE id = $2`,
		enabled, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
