package repo

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Holiday 节假日/调休工作日
type Holiday struct {
	ID        int       `json:"id"`
	Date      time.Time `json:"date"`
	IsHoliday bool      `json:"is_holiday"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

// HolidayRepo 节假日数据访问层
type HolidayRepo struct {
	pool *pgxpool.Pool
}

func NewHolidayRepo(pool *pgxpool.Pool) *HolidayRepo {
	return &HolidayRepo{pool: pool}
}

// List 查询全部节假日（按日期排序）
func (r *HolidayRepo) List(ctx context.Context) ([]Holiday, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, date, is_holiday, name, created_at FROM holidays ORDER BY date`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []Holiday
	for rows.Next() {
		var h Holiday
		if err := rows.Scan(&h.ID, &h.Date, &h.IsHoliday, &h.Name, &h.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, h)
	}
	return items, rows.Err()
}

// ListByYear 查询某年节假日
func (r *HolidayRepo) ListByYear(ctx context.Context, year int) ([]Holiday, error) {
	start := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(year+1, 1, 1, 0, 0, 0, 0, time.UTC)
	rows, err := r.pool.Query(ctx,
		`SELECT id, date, is_holiday, name, created_at FROM holidays
		 WHERE date >= $1 AND date < $2 ORDER BY date`, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []Holiday
	for rows.Next() {
		var h Holiday
		if err := rows.Scan(&h.ID, &h.Date, &h.IsHoliday, &h.Name, &h.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, h)
	}
	return items, rows.Err()
}

// Create 创建节假日
func (r *HolidayRepo) Create(ctx context.Context, date time.Time, isHoliday bool, name string) (*Holiday, error) {
	h := &Holiday{}
	err := r.pool.QueryRow(ctx,
		`INSERT INTO holidays (date, is_holiday, name) VALUES ($1, $2, $3)
		 ON CONFLICT (date) DO UPDATE SET is_holiday = EXCLUDED.is_holiday, name = EXCLUDED.name
		 RETURNING id, date, is_holiday, name, created_at`,
		date, isHoliday, name,
	).Scan(&h.ID, &h.Date, &h.IsHoliday, &h.Name, &h.CreatedAt)
	if err != nil {
		return nil, err
	}
	return h, nil
}

// BatchUpsert 批量创建/更新节假日（用于年度导入）
func (r *HolidayRepo) BatchUpsert(ctx context.Context, items []Holiday) (int, error) {
	if len(items) == 0 {
		return 0, nil
	}
	count := 0
	for _, h := range items {
		_, err := r.pool.Exec(ctx,
			`INSERT INTO holidays (date, is_holiday, name) VALUES ($1, $2, $3)
			 ON CONFLICT (date) DO UPDATE SET is_holiday = EXCLUDED.is_holiday, name = EXCLUDED.name`,
			h.Date, h.IsHoliday, h.Name)
		if err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

// Update 更新节假日
func (r *HolidayRepo) Update(ctx context.Context, id int, date time.Time, isHoliday bool, name string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE holidays SET date = $1, is_holiday = $2, name = $3 WHERE id = $4`,
		date, isHoliday, name, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete 删除节假日
func (r *HolidayRepo) Delete(ctx context.Context, id int) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM holidays WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteByYear 删除某年全部节假日（用于年度重新导入）
func (r *HolidayRepo) DeleteByYear(ctx context.Context, year int) (int64, error) {
	start := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(year+1, 1, 1, 0, 0, 0, 0, time.UTC)
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM holidays WHERE date >= $1 AND date < $2`, start, end)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// GetByID 按 ID 查询
func (r *HolidayRepo) GetByID(ctx context.Context, id int) (*Holiday, error) {
	h := &Holiday{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, date, is_holiday, name, created_at FROM holidays WHERE id = $1`, id,
	).Scan(&h.ID, &h.Date, &h.IsHoliday, &h.Name, &h.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return h, nil
}

// IsWorkday 判断给定日期是否为工作日
// 规则：先查 holidays 表，如果 is_holiday=true 则非工作日，is_holiday=false（调休）则工作日
// 如果不在表中，则按周一~周五为工作日，周六日为休息日
func (r *HolidayRepo) IsWorkday(ctx context.Context, t time.Time) (bool, error) {
	date := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	var isHoliday *bool
	err := r.pool.QueryRow(ctx,
		`SELECT is_holiday FROM holidays WHERE date = $1`, date,
	).Scan(&isHoliday)
	if err == nil {
		// 在表中：is_holiday=true → 非工作日，is_holiday=false（调休）→ 工作日
		if isHoliday != nil {
			return !*isHoliday, nil
		}
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	// 不在表中：周一~周五为工作日
	wd := t.Weekday()
	return wd >= time.Monday && wd <= time.Friday, nil
}

// PrevWorkdayStart 获取上一个工作日的开始时间（0点）
// 用于计算"昨日均价"等场景
func (r *HolidayRepo) PrevWorkdayStart(ctx context.Context, from time.Time) (time.Time, error) {
	// 从前一天开始往前找
	d := from.AddDate(0, 0, -1)
	for i := 0; i < 30; i++ { // 最多回溯30天
		isWork, err := r.IsWorkday(ctx, d)
		if err != nil {
			return from, err
		}
		if isWork {
			return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, d.Location()), nil
		}
		d = d.AddDate(0, 0, -1)
	}
	return from, nil
}

// DayStart 返回当天 0 点时间
func (r *HolidayRepo) DayStart(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}
