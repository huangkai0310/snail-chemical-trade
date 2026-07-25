package handler

import (
	"fmt"
	"strings"
	"time"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/calendar"
)

func shanghaiLoc() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("CST", 8*3600)
	}
	return loc
}

// nextWorkdayOnOrAfter 从 day（0 点）起含当日找最近工作日
func nextWorkdayOnOrAfter(day time.Time) time.Time {
	d := calendar.DayStart(day)
	for i := 0; i < 40; i++ {
		if calendar.IsWorkday(d) {
			return d
		}
		d = d.AddDate(0, 0, 1)
	}
	return calendar.DayStart(day)
}

// DefaultExpiresAt 默认过期：当天 18:00（Asia/Shanghai）；
// 若已过 18:00 或当日非工作日，则顺延至下一工作日 18:00。
func DefaultExpiresAt(now time.Time) time.Time {
	loc := shanghaiLoc()
	now = now.In(loc)
	today := calendar.DayStart(now)
	today18 := time.Date(now.Year(), now.Month(), now.Day(), 18, 0, 0, 0, loc)
	var day time.Time
	if calendar.IsWorkday(today) && now.Before(today18) {
		day = today
	} else {
		day = nextWorkdayOnOrAfter(today.AddDate(0, 0, 1))
	}
	return time.Date(day.Year(), day.Month(), day.Day(), 18, 0, 0, 0, loc)
}

func requireWorkday(t time.Time, label string) error {
	if !calendar.IsWorkday(t) {
		return fmt.Errorf("%s须为工作日（周末/法定节假日不可选）", label)
	}
	return nil
}

// ResolveExpiresAt 解析客户端过期时间；空则用默认。必须晚于 now，且须为工作日。
func ResolveExpiresAt(raw *string, now time.Time) (time.Time, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return DefaultExpiresAt(now), nil
	}
	t, err := parseTimeFlexible(strings.TrimSpace(*raw))
	if err != nil {
		return time.Time{}, fmt.Errorf("过期时间格式无效")
	}
	if !t.After(now) {
		return time.Time{}, fmt.Errorf("过期时间必须晚于当前时间")
	}
	max := now.Add(7 * 24 * time.Hour)
	if t.After(max) {
		return time.Time{}, fmt.Errorf("过期时间不能超过 7 天")
	}
	if err := requireWorkday(t, "过期时间"); err != nil {
		return time.Time{}, err
	}
	return t, nil
}

// ResolveStartsAt 解析开始时间；空则立即发布。返回 (startsAt, scheduled)。
// scheduled=true 表示未来定时发布；startsAt 为计划开始时间。
// 立即发布时当日须为工作日；预约开始日须为工作日。
func ResolveStartsAt(raw *string, now time.Time) (*time.Time, bool, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		if err := requireWorkday(now, "开始时间"); err != nil {
			return nil, false, fmt.Errorf("休市日不可立即挂盘，请预约至下一工作日")
		}
		return nil, false, nil
	}
	t, err := parseTimeFlexible(strings.TrimSpace(*raw))
	if err != nil {
		return nil, false, fmt.Errorf("开始时间格式无效")
	}
	if !t.After(now) {
		// 已过或等于当前 → 立即发布
		if err := requireWorkday(now, "开始时间"); err != nil {
			return nil, false, fmt.Errorf("休市日不可立即挂盘，请预约至下一工作日")
		}
		return nil, false, nil
	}
	max := now.Add(7 * 24 * time.Hour)
	if t.After(max) {
		return nil, false, fmt.Errorf("开始时间不能超过 7 天")
	}
	if err := requireWorkday(t, "开始时间"); err != nil {
		return nil, false, err
	}
	return &t, true, nil
}

func parseTimeFlexible(s string) (time.Time, error) {
	var t time.Time
	var err error
	t, err = time.Parse(time.RFC3339, s)
	if err != nil {
		t, err = time.Parse(time.RFC3339Nano, s)
	}
	if err != nil {
		t, err = time.ParseInLocation("2006-01-02T15:04:05", s, shanghaiLoc())
	}
	if err != nil {
		t, err = time.ParseInLocation("2006-01-02T15:04", s, shanghaiLoc())
	}
	if err != nil {
		t, err = time.ParseInLocation("2006-01-02 15:04:05", s, shanghaiLoc())
	}
	if err != nil {
		t, err = time.ParseInLocation("2006-01-02 15:04", s, shanghaiLoc())
	}
	return t, err
}
