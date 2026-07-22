package calendar

import (
	"testing"
	"time"
)

func TestPrevWorkdayAroundHolidays(t *testing.T) {
	cases := []struct {
		today string
		want  string
	}{
		// 普通周中
		{"2026-07-23", "2026-07-22"}, // 周四 → 周三
		{"2026-07-20", "2026-07-17"}, // 周一 → 上周五
		// 元旦后：1/4 周日调休上班，1/5 周一的上一工作日是 1/4
		{"2026-01-05", "2026-01-04"},
		// 春节后首个工作日 2/24 周二 → 上一工作日为调休上班 2/28？不对
		// 2/15–2/23 放假；2/14、2/28 调休上班。2/24 的上一工作日是 2/14
		{"2026-02-24", "2026-02-14"},
		// 劳动节后 5/6 周三 → 上一工作日 5/9？5/1–5/5 放假，5/9 调休。5/6 上一工作日是 4/30
		{"2026-05-06", "2026-04-30"},
		// 国庆后 10/8 周四 → 上一工作日 10/10 不对；10/1–10/7 放假，10/10 调休。10/8 上一是 9/20？
		// 9/25–9/27 中秋放假；9/20 调休上班；9/28–9/30 工作日。10/8 上一工作日 = 9/30
		{"2026-10-08", "2026-09-30"},
		// 清明后 4/7 周二 → 4/3 周五（4/4–4/6 放假）
		{"2026-04-07", "2026-04-03"},
	}
	for _, tc := range cases {
		today, err := time.ParseInLocation("2006-01-02", tc.today, Shanghai)
		if err != nil {
			t.Fatal(err)
		}
		got := PrevWorkdayStart(today).Format("2006-01-02")
		if got != tc.want {
			t.Errorf("PrevWorkdayStart(%s)=%s, want %s", tc.today, got, tc.want)
		}
	}
}

func TestIsWorkdayMakeup(t *testing.T) {
	d, _ := time.ParseInLocation("2006-01-02", "2026-01-04", Shanghai) // 周日调休
	if !IsWorkday(d) {
		t.Error("2026-01-04 should be workday (makeup)")
	}
	h, _ := time.ParseInLocation("2006-01-02", "2026-01-01", Shanghai)
	if IsWorkday(h) {
		t.Error("2026-01-01 should be holiday")
	}
}
