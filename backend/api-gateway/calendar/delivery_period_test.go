package calendar

import (
	"testing"
	"time"
)

func TestParseDeliveryPeriodDate_YYMMDD(t *testing.T) {
	d, ok := ParseDeliveryPeriodDate("260725")
	if !ok {
		t.Fatal("expected ok")
	}
	if d.Year() != 2026 || d.Month() != time.July || d.Day() != 25 {
		t.Fatalf("got %v", d)
	}
}

func TestIsDeliveryPast(t *testing.T) {
	now := time.Date(2026, 7, 26, 10, 0, 0, 0, Shanghai)
	if !IsDeliveryPast("260725", now) {
		t.Fatal("260725 should be past on 7/26")
	}
	if IsDeliveryPast("260725", time.Date(2026, 7, 25, 23, 0, 0, 0, Shanghai)) {
		t.Fatal("260725 should still be valid on delivery day")
	}
	if IsDeliveryPast("现货", now) {
		t.Fatal("spot never past")
	}
}
