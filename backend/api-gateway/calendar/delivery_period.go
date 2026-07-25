package calendar

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	reYYMMDD   = regexp.MustCompile(`^(\d{2})(\d{2})(\d{2})$`)
	reYYYYMMDD = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`)
	reYYMMTag  = regexp.MustCompile(`^(\d{2})(\d{2})([上中下])$`)
)

// MidMonthDate 当月月中锚定日：优先 15 日，若非工作日则向后找最近工作日
func MidMonthDate(year int, month time.Month) time.Time {
	d := time.Date(year, month, 15, 0, 0, 0, 0, Shanghai)
	for i := 0; i < 20; i++ {
		if IsWorkday(d) {
			return d
		}
		d = d.AddDate(0, 0, 1)
	}
	return time.Date(year, month, 15, 0, 0, 0, 0, Shanghai)
}

// LastWorkdayOfMonth 当月最后一个工作日
func LastWorkdayOfMonth(year int, month time.Month) time.Time {
	// 下月 1 号的前一天
	d := time.Date(year, month+1, 1, 0, 0, 0, 0, Shanghai).AddDate(0, 0, -1)
	for i := 0; i < 40; i++ {
		if IsWorkday(d) {
			return d
		}
		d = d.AddDate(0, 0, -1)
	}
	return d
}

// ParseDeliveryPeriodDate 将交割期文案解析为锚定交割日（上海 00:00）。
// 支持：YYMMDD / YYYY-MM-DD / YYMM中 / YYMM下 / YYMM上（上≈月中）。
// 现货或无法解析返回 ok=false。
func ParseDeliveryPeriodDate(period string) (time.Time, bool) {
	p := strings.TrimSpace(period)
	if p == "" || p == "现货" {
		return time.Time{}, false
	}

	if m := reYYYYMMDD.FindStringSubmatch(p); m != nil {
		y, _ := strconv.Atoi(m[1])
		mo, _ := strconv.Atoi(m[2])
		day, _ := strconv.Atoi(m[3])
		d := time.Date(y, time.Month(mo), day, 0, 0, 0, 0, Shanghai)
		if d.Year() == y && int(d.Month()) == mo && d.Day() == day {
			return d, true
		}
		return time.Time{}, false
	}

	if m := reYYMMDD.FindStringSubmatch(p); m != nil {
		y := 2000 + mustAtoi(m[1])
		mo := mustAtoi(m[2])
		day := mustAtoi(m[3])
		d := time.Date(y, time.Month(mo), day, 0, 0, 0, 0, Shanghai)
		if d.Year() == y && int(d.Month()) == mo && d.Day() == day {
			return d, true
		}
		return time.Time{}, false
	}

	if m := reYYMMTag.FindStringSubmatch(p); m != nil {
		y := 2000 + mustAtoi(m[1])
		mo := time.Month(mustAtoi(m[2]))
		if mo < 1 || mo > 12 {
			return time.Time{}, false
		}
		switch m[3] {
		case "下":
			return LastWorkdayOfMonth(y, mo), true
		case "中", "上":
			return MidMonthDate(y, mo), true
		}
	}

	return time.Time{}, false
}

// IsDeliveryPast 交割日严格早于今日（上海自然日）则视为已过期。交割当天仍有效。
func IsDeliveryPast(period string, now time.Time) bool {
	d, ok := ParseDeliveryPeriodDate(period)
	if !ok {
		return false
	}
	today := DayStart(now)
	return d.Before(today)
}

func mustAtoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}
