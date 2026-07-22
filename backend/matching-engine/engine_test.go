package engine

import (
	"testing"
	"time"
)

func TestBasicMatch(t *testing.T) {
    eng := NewEngine()

    // 卖盘：1000 吨甲醇 @ 2450
    sell := NewOrder("methanol", SideSell, 2450, 1000, "seller-1")
    trades := eng.Execute(sell)
    if len(trades) != 0 {
        t.Error("expected no trades on first sell order")
    }

    // 买盘：1000 吨甲醇 @ 2450（完全匹配）
    buy := NewOrder("methanol", SideBuy, 2450, 1000, "buyer-1")
    trades = eng.Execute(buy)
    if len(trades) != 1 {
        t.Fatal("expected 1 trade")
    }
    if trades[0].Quantity != 1000 {
        t.Errorf("expected qty 1000, got %f", trades[0].Quantity)
    }
}

func TestPriceTimePriority(t *testing.T) {
    eng := NewEngine()

    // 卖1：1000t @ 2450
    eng.LoadOrder(OrderFromListing("sell-1", "methanol", "s1", SideSell, 2450, 1000, 0, 0, true, StatusOpen, time.Now()))
    // 卖2：1000t @ 2440（更便宜，应优先成交）
    eng.LoadOrder(OrderFromListing("sell-2", "methanol", "s2", SideSell, 2440, 1000, 0, 0, true, StatusOpen, time.Now()))

    // 买家出 2450
    buy := OrderFromListing("buy-1", "methanol", "b1", SideBuy, 2450, 500, 0, 0, true, StatusOpen, time.Now())
    trades := eng.Execute(buy)
    if len(trades) == 0 {
        t.Fatal("expected at least 1 trade")
    }
    if trades[0].SellOrder != "sell-2" {
        t.Errorf("expected match with sell-2 first (price priority), got %s", trades[0].SellOrder)
    }
}

func TestPartialFill(t *testing.T) {
    eng := NewEngine()

    eng.Execute(NewOrder("methanol", SideSell, 2450, 1000, "s1"))
    // 只买 500t
    trades := eng.Execute(NewOrder("methanol", SideBuy, 2450, 500, "b1"))

    if len(trades) != 1 || trades[0].Quantity != 500 {
        t.Fatal("expected 500t partial trade")
    }

    book := eng.GetBook("methanol")
	book.Mu.RLock()
	if len(*book.SellHeap) != 1 {
		t.Error("sell order should remain in book (partial fill)")
	}
	book.Mu.RUnlock()
}

func TestTakeListing(t *testing.T) {
    eng := NewEngine()

    sellID := "sell-listing-1"
    sell := OrderFromListing(sellID, "benzene", "seller-1", SideSell, 2450, 1000, 0, 0, true, StatusOpen, time.Now())
    eng.LoadOrder(sell)

    takerID := "buy-listing-1"
    taker := OrderFromListing(takerID, "benzene", "buyer-1", SideBuy, 2450, 500, 0, 0, true, StatusOpen, time.Now())
    trades, err := eng.TakeListing("benzene", sellID, taker)
    if err != nil {
        t.Fatal(err)
    }
    if len(trades) != 1 || trades[0].Quantity != 500 {
        t.Fatalf("expected 500t trade, got %+v", trades)
    }
    if trades[0].SellOrder != sellID || trades[0].BuyOrder != takerID {
        t.Errorf("unexpected order ids: %+v", trades[0])
    }
}

// TestMinQuantitySkipsOpponent 验证：对手盘设了最小单量时，小单不会部分吃掉对手盘
func TestMinQuantitySkipsOpponent(t *testing.T) {
	eng := NewEngine()

	// 卖盘 1000t @ 2450，最小单量 100（不接受小于 100 的单笔成交）
	sell := OrderFromListing("sell-min", "methanol", "s1", SideSell, 2450, 1000, 0, 100, true, StatusOpen, time.Now())
	eng.LoadOrder(sell)

	// 买家只买 50t，低于对手盘最小单量 -> 不应成交
	buy := OrderFromListing("buy-small", "methanol", "b1", SideBuy, 2450, 50, 0, 0, true, StatusOpen, time.Now())
	trades := eng.Execute(buy)

	if len(trades) != 0 {
		t.Fatalf("expected NO trade (below counterparty min quantity), got %+v", trades)
	}

	book := eng.GetBook("methanol")
	book.Mu.RLock()
	if len(*book.SellHeap) != 1 {
		t.Error("对手盘应仍在订单簿中未被吃掉")
	}
	book.Mu.RUnlock()
}

// TestMinQuantityAllowsSufficientTaker 验证：买方量足够覆盖对手盘最小单量时正常成交
func TestMinQuantityAllowsSufficientTaker(t *testing.T) {
	eng := NewEngine()

	// 卖盘 1000t @ 2450，最小单量 100
	sell := OrderFromListing("sell-min", "methanol", "s1", SideSell, 2450, 1000, 0, 100, true, StatusOpen, time.Now())
	eng.LoadOrder(sell)

	// 买家买 150t >= 100 -> 正常成交 150t
	buy := OrderFromListing("buy-ok", "methanol", "b1", SideBuy, 2450, 150, 0, 0, true, StatusOpen, time.Now())
	trades := eng.Execute(buy)

	if len(trades) != 1 || trades[0].Quantity != 150 {
		t.Fatalf("expected 150t trade, got %+v", trades)
	}
	if trades[0].SellOrder != "sell-min" {
		t.Errorf("unexpected sell order: %s", trades[0].SellOrder)
	}
}

// TestTakeListingRejectsBelowMinQuantity 验证：摘牌量低于对手盘最小单量且未吃完时拒绝
func TestTakeListingRejectsBelowMinQuantity(t *testing.T) {
	eng := NewEngine()

	// 卖盘 1000t @ 2450，最小单量 100
	sell := OrderFromListing("sell-min", "benzene", "s1", SideSell, 2450, 1000, 0, 100, true, StatusOpen, time.Now())
	eng.LoadOrder(sell)

	// 摘牌只摘 50t < 100，且对手盘仍有余量 -> 应返回 ErrMinQuantity
	taker := OrderFromListing("taker", "benzene", "b1", SideBuy, 2450, 50, 0, 0, true, StatusOpen, time.Now())
	_, err := eng.TakeListing("benzene", "sell-min", taker)
	if err != ErrMinQuantity {
		t.Fatalf("expected ErrMinQuantity, got %v", err)
	}
}

// TestTakeListingAllowsFullRemainder 验证：摘牌量覆盖对手盘全部余量时允许清算（即使余量低于最小单量）
func TestTakeListingAllowsFullRemainder(t *testing.T) {
	eng := NewEngine()

	// 卖盘 1000t @ 2450，最小单量 100，已成交 950（余量 50 < 最小单量）
	sell := OrderFromListing("sell-leftover", "benzene", "s1", SideSell, 2450, 1000, 950, 100, true, StatusPartial, time.Now())
	eng.LoadOrder(sell)

	// 摘牌 50t，正好吃掉全部余量 -> 允许清算
	taker := OrderFromListing("taker", "benzene", "b1", SideBuy, 2450, 50, 0, 0, true, StatusOpen, time.Now())
	trades, err := eng.TakeListing("benzene", "sell-leftover", taker)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(trades) != 1 || trades[0].Quantity != 50 {
		t.Fatalf("expected 50t cleanup trade, got %+v", trades)
	}
}

// ============ Issue 6：不可拆挂牌（allow_partial=false）不应被部分成交 ============

// TestAllowPartialBlocksPartialFill 验证：不可拆挂牌不会被小于剩余量的自动撮合部分吃掉
func TestAllowPartialBlocksPartialFill(t *testing.T) {
	eng := NewEngine()

	// 卖盘 1000t @ 2450，不可拆（allowPartial=false），最小单量 0
	sell := OrderFromListing("sell-nosplit", "methanol", "s1", SideSell, 2450, 1000, 0, 0, false, StatusOpen, time.Now())
	eng.LoadOrder(sell)

	// 买家只买 500t < 1000 剩余 -> 不可拆，应跳过，不成交
	buy := OrderFromListing("buy-partial", "methanol", "b1", SideBuy, 2450, 500, 0, 0, true, StatusOpen, time.Now())
	trades := eng.Execute(buy)

	if len(trades) != 0 {
		t.Fatalf("expected NO trade (listing not splittable), got %+v", trades)
	}
	book := eng.GetBook("methanol")
	book.Mu.RLock()
	if len(*book.SellHeap) != 1 {
		t.Error("不可拆卖盘应仍在订单簿中")
	}
	book.Mu.RUnlock()
}

// TestAllowPartialAllowsFullTake 验证：买方量足以一次吃完不可拆挂牌时正常成交
func TestAllowPartialAllowsFullTake(t *testing.T) {
	eng := NewEngine()

	sell := OrderFromListing("sell-nosplit", "methanol", "s1", SideSell, 2450, 1000, 0, 0, false, StatusOpen, time.Now())
	eng.LoadOrder(sell)

	// 买家买 1000t == 剩余 -> 整单成交
	buy := OrderFromListing("buy-full", "methanol", "b1", SideBuy, 2450, 1000, 0, 0, true, StatusOpen, time.Now())
	trades := eng.Execute(buy)

	if len(trades) != 1 || trades[0].Quantity != 1000 {
		t.Fatalf("expected 1000t full trade, got %+v", trades)
	}
}

// TestTakeListingRejectsNonPartial 验证：不可拆挂牌不允许部分摘牌
func TestTakeListingRejectsNonPartial(t *testing.T) {
	eng := NewEngine()

	sell := OrderFromListing("sell-nosplit", "benzene", "s1", SideSell, 2450, 1000, 0, 0, false, StatusOpen, time.Now())
	eng.LoadOrder(sell)

	// 只摘 500t < 1000 剩余，且不可拆 -> 应拒绝
	taker := OrderFromListing("taker", "benzene", "b1", SideBuy, 2450, 500, 0, 0, true, StatusOpen, time.Now())
	_, err := eng.TakeListing("benzene", "sell-nosplit", taker)
	if err != ErrMinQuantity {
		t.Fatalf("expected ErrMinQuantity (non-splittable), got %v", err)
	}
}

// ============ Issue 7：自成交不再用 break 提前终止整个撮合循环 ============

// TestSelfTradeContinuesLoop 验证：自成交应 stash 后继续，而非 break 终止循环
func TestSelfTradeContinuesLoop(t *testing.T) {
	eng := NewEngine()

	// 两个卖盘：me@2450（更便宜，堆顶）, other@2460（堆底）
	eng.LoadOrder(OrderFromListing("sell-me", "methanol", "me", SideSell, 2450, 1000, 0, 0, true, StatusOpen, time.Now()))
	eng.LoadOrder(OrderFromListing("sell-other", "methanol", "other", SideSell, 2460, 1000, 0, 0, true, StatusOpen, time.Now()))

	// 买家是 me，价格 2500 可匹配两者；自成交应跳过 me 自己的卖盘，继续与 other 成交
	buy := OrderFromListing("buy-me", "methanol", "me", SideBuy, 2500, 1000, 0, 0, true, StatusOpen, time.Now())
	trades := eng.Execute(buy)

	if len(trades) != 1 {
		t.Fatalf("expected 1 trade with other (self-trade skipped), got %+v", trades)
	}
	if trades[0].SellOrder != "sell-other" {
		t.Errorf("expected trade with sell-other, got %s", trades[0].SellOrder)
	}
	if trades[0].Quantity != 1000 {
		t.Errorf("expected 1000t trade, got %f", trades[0].Quantity)
	}
}

// ============ Issue 3：黑名单双向拦截 ============

// mockBlocker 简易黑名单检查器，仅对显式登记的 (taker|maker) 返回 true
type mockBlocker struct {
	blocked map[string]bool
}

func (m *mockBlocker) IsBlocked(taker, maker string) bool {
	return m.blocked[taker+"|"+maker]
}

// TestBlacklistBidirectionalMatch 验证：A 拉黑 B 时，B 也无法与 A 自动撮合成交
func TestBlacklistBidirectionalMatch(t *testing.T) {
	eng := NewEngine()
	// A 拉黑了 B（仅单向登记）
	eng.SetBlacklistChecker(&mockBlocker{blocked: map[string]bool{"A|B": true}})

	// 卖盘归属 A；买家是 B。虽然 B 没拉黑 A，但 A 拉黑了 B，应双向拦截
	eng.LoadOrder(OrderFromListing("sell-A", "methanol", "A", SideSell, 2450, 1000, 0, 0, true, StatusOpen, time.Now()))
	buy := OrderFromListing("buy-B", "methanol", "B", SideBuy, 2450, 500, 0, 0, true, StatusOpen, time.Now())
	trades := eng.Execute(buy)

	if len(trades) != 0 {
		t.Fatalf("expected NO trade (A blocked B, bidirectional), got %+v", trades)
	}
}

// TestBlacklistBidirectionalTakeListing 验证：摘牌场景同样双向拦截
func TestBlacklistBidirectionalTakeListing(t *testing.T) {
	eng := NewEngine()
	eng.SetBlacklistChecker(&mockBlocker{blocked: map[string]bool{"A|B": true}})

	eng.LoadOrder(OrderFromListing("sell-A", "benzene", "A", SideSell, 2450, 1000, 0, 0, true, StatusOpen, time.Now()))
	// B 摘牌 A 的卖盘：双向拦截应拒绝
	taker := OrderFromListing("take-B", "benzene", "B", SideBuy, 2450, 500, 0, 0, true, StatusOpen, time.Now())
	_, err := eng.TakeListing("benzene", "sell-A", taker)
	if err != ErrBlacklisted {
		t.Fatalf("expected ErrBlacklisted, got %v", err)
	}
}

// ============ 撮合隔离：交割期 / 交割方式 / 免仓期 不同则不自动撮合 ============

func newOrderTerms(id string, side Side, price, qty float64, uid, period, method string, fsEnabled bool, fsDays int) *Order {
	o := OrderFromListing(id, "methanol", uid, side, price, qty, 0, 0, true, StatusOpen, time.Now())
	o.DeliveryPeriod = period
	o.DeliveryMethod = method
	o.FreeStorageEnabled = fsEnabled
	o.FreeStorageDays = fsDays
	return o
}

// TestMatchIsolationDeliveryMethod 验证：交割方式不同不自动撮合
func TestMatchIsolationDeliveryMethod(t *testing.T) {
	eng := NewEngine()
	eng.LoadOrder(newOrderTerms("sell-1", SideSell, 2450, 100, "s1", "现货", "自提", true, 7))
	buy := newOrderTerms("buy-1", SideBuy, 2450, 100, "b1", "现货", "送到", true, 7) // 交割方式不同
	trades := eng.Execute(buy)
	if len(trades) != 0 {
		t.Fatalf("交割方式不同不应撮合，got %+v", trades)
	}
}

// TestMatchIsolationFreeStorage 验证：免仓期不同不自动撮合
func TestMatchIsolationFreeStorage(t *testing.T) {
	eng := NewEngine()
	eng.LoadOrder(newOrderTerms("sell-1", SideSell, 2450, 100, "s1", "现货", "自提", true, 7))
	buy := newOrderTerms("buy-1", SideBuy, 2450, 100, "b1", "现货", "自提", true, 3) // 免仓天数不同
	trades := eng.Execute(buy)
	if len(trades) != 0 {
		t.Fatalf("免仓期不同不应撮合，got %+v", trades)
	}
}

// TestMatchIsolationDeliveryPeriod 验证：交割期不同不自动撮合
func TestMatchIsolationDeliveryPeriod(t *testing.T) {
	eng := NewEngine()
	eng.LoadOrder(newOrderTerms("sell-1", SideSell, 2450, 100, "s1", "现货", "自提", true, 7))
	buy := newOrderTerms("buy-1", SideBuy, 2450, 100, "b1", "2026-08", "自提", true, 7) // 交割期不同
	trades := eng.Execute(buy)
	if len(trades) != 0 {
		t.Fatalf("交割期不同不应撮合，got %+v", trades)
	}
}

// TestMatchSameTermsMatches 验证：条款完全一致正常撮合
func TestMatchSameTermsMatches(t *testing.T) {
	eng := NewEngine()
	eng.LoadOrder(newOrderTerms("sell-1", SideSell, 2450, 100, "s1", "现货", "自提", true, 7))
	buy := newOrderTerms("buy-1", SideBuy, 2450, 100, "b1", "现货", "自提", true, 7) // 条款一致
	trades := eng.Execute(buy)
	if len(trades) != 1 || trades[0].Quantity != 100 {
		t.Fatalf("条款一致应成交 100t，got %+v", trades)
	}
}

// ============ 不可拆主动方：全成交或不成交，不留孤儿单 ============

// TestNonPartialAggressorNoOrphan 验证：不可拆买单无法一次性全部成交时不产生孤儿单
func TestNonPartialAggressorNoOrphan(t *testing.T) {
	eng := NewEngine()
	// 卖盘只有 50t（可拆）
	eng.LoadOrder(OrderFromListing("sell-1", "methanol", "s1", SideSell, 2450, 50, 0, 0, true, StatusOpen, time.Now()))
	// 不可拆买单要 100t，卖盘不足以一次吃完 -> 不应成交，且买单不应留下部分成交
	buy := OrderFromListing("buy-nosplit", "methanol", "b1", SideBuy, 2450, 100, 0, 0, false, StatusOpen, time.Now())
	trades := eng.Execute(buy)
	if len(trades) != 0 {
		t.Fatalf("不可拆买单无法全额成交时不应产生交易，got %+v", trades)
	}
	if buy.Filled != 0 {
		t.Fatalf("不可拆买单不应被部分成交，filled=%f", buy.Filled)
	}
	// 卖盘应仍完整留在订单簿
	book := eng.GetBook("methanol")
	book.Mu.RLock()
	if len(*book.SellHeap) != 1 || (*book.SellHeap)[0].Filled != 0 {
		t.Errorf("对手卖盘应保持未成交")
	}
	book.Mu.RUnlock()
}

// TestNonPartialAggressorFullFillAcrossMultiple 验证：不可拆买单可被多个卖盘凑齐全额成交
func TestNonPartialAggressorFullFillAcrossMultiple(t *testing.T) {
	eng := NewEngine()
	eng.LoadOrder(OrderFromListing("sell-1", "methanol", "s1", SideSell, 2450, 60, 0, 0, true, StatusOpen, time.Now()))
	eng.LoadOrder(OrderFromListing("sell-2", "methanol", "s2", SideSell, 2450, 40, 0, 0, true, StatusOpen, time.Now()))
	// 不可拆买单 100t = 60 + 40，可凑齐 -> 全额成交
	buy := OrderFromListing("buy-nosplit", "methanol", "b1", SideBuy, 2450, 100, 0, 0, false, StatusOpen, time.Now())
	trades := eng.Execute(buy)
	var total float64
	for _, tr := range trades {
		total += tr.Quantity
	}
	if total != 100 || buy.Filled != 100 {
		t.Fatalf("不可拆买单应被凑齐 100t，got total=%f filled=%f trades=%+v", total, buy.Filled, trades)
	}
}
