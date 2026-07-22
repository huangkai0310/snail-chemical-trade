// Package calendar 提供中国大陆法定节假日 / 调休上班日判断，
// 用于昨结等业务的「上一工作日」计算。
// 数据来源：国务院办公厅当年节假日安排通知；每年国务院发文后需补充。
package calendar

import "time"

// Shanghai 交易日历时区（北京时间）
var Shanghai *time.Location

func init() {
	var err error
	Shanghai, err = time.LoadLocation("Asia/Shanghai")
	if err != nil {
		Shanghai = time.FixedZone("CST", 8*3600)
	}
}

// 法定放假日（含调休连休中的周末）
var holidays = map[string]struct{}{}

// 调休上班日（周末但计为工作日）
var makeupWorkdays = map[string]struct{}{}

func init() {
	// —— 2025（国办发明电〔2024〕12号）——
	addRange(holidays, "2025-01-01", "2025-01-01")
	addRange(holidays, "2025-01-28", "2025-02-04") // 春节
	addRange(holidays, "2025-04-04", "2025-04-06") // 清明
	addRange(holidays, "2025-05-01", "2025-05-05") // 劳动节
	addRange(holidays, "2025-05-31", "2025-06-02") // 端午
	addRange(holidays, "2025-10-01", "2025-10-08") // 国庆+中秋
	addDay(makeupWorkdays, "2025-01-26")
	addDay(makeupWorkdays, "2025-02-08")
	addDay(makeupWorkdays, "2025-04-27")
	addDay(makeupWorkdays, "2025-09-28")
	addDay(makeupWorkdays, "2025-10-11")

	// —— 2026（国办发明电〔2025〕7号）——
	addRange(holidays, "2026-01-01", "2026-01-03") // 元旦
	addRange(holidays, "2026-02-15", "2026-02-23") // 春节
	addRange(holidays, "2026-04-04", "2026-04-06") // 清明
	addRange(holidays, "2026-05-01", "2026-05-05") // 劳动节
	addRange(holidays, "2026-06-19", "2026-06-21") // 端午
	addRange(holidays, "2026-09-25", "2026-09-27") // 中秋
	addRange(holidays, "2026-10-01", "2026-10-07") // 国庆
	addDay(makeupWorkdays, "2026-01-04")
	addDay(makeupWorkdays, "2026-02-14")
	addDay(makeupWorkdays, "2026-02-28")
	addDay(makeupWorkdays, "2026-05-09")
	addDay(makeupWorkdays, "2026-09-20")
	addDay(makeupWorkdays, "2026-10-10")
}

func addDay(m map[string]struct{}, day string) {
	m[day] = struct{}{}
}

func addRange(m map[string]struct{}, from, to string) {
	start, err1 := time.ParseInLocation("2006-01-02", from, Shanghai)
	end, err2 := time.ParseInLocation("2006-01-02", to, Shanghai)
	if err1 != nil || err2 != nil {
		return
	}
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		m[d.Format("2006-01-02")] = struct{}{}
	}
}

// DayStart 返回 t 所在上海自然日的 00:00
func DayStart(t time.Time) time.Time {
	t = t.In(Shanghai)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, Shanghai)
}

// IsWorkday 是否为工作日：调休上班日为是；法定放假日为否；其余按周一至周五。
func IsWorkday(t time.Time) bool {
	key := DayStart(t).Format("2006-01-02")
	if _, ok := makeupWorkdays[key]; ok {
		return true
	}
	if _, ok := holidays[key]; ok {
		return false
	}
	wd := DayStart(t).Weekday()
	return wd != time.Saturday && wd != time.Sunday
}

// PrevWorkdayStart 返回「相对于 from 所在日」的上一个工作日 00:00（上海时区）。
// from 通常为今日 00:00。
func PrevWorkdayStart(from time.Time) time.Time {
	d := DayStart(from).AddDate(0, 0, -1)
	for i := 0; i < 40; i++ {
		if IsWorkday(d) {
			return d
		}
		d = d.AddDate(0, 0, -1)
	}
	return DayStart(from).AddDate(0, 0, -1)
}
