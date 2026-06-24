package engine

import "testing"

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
    eng.Execute(NewOrder("methanol", SideSell, 2450, 1000, "s1"))
    // 卖2：1000t @ 2440（更便宜，应优先成交）
    eng.Execute(NewOrder("methanol", SideSell, 2440, 1000, "s2"))

    // 买家出 2450
    trades := eng.Execute(NewOrder("methanol", SideBuy, 2450, 500, "b1"))
    if len(trades) == 0 {
        t.Fatal("expected at least 1 trade")
    }
    // 应该先跟 s2（2440）成交
    if trades[0].SellOrder != "s2" {
        t.Errorf("expected match with s2 first (price priority), got %s", trades[0].SellOrder)
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
