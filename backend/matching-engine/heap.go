package engine

// ========== MinHeap (卖盘：价格从低到高) ==========

type MinHeap []*Order

func (h MinHeap) Len() int { return len(h) }
func (h MinHeap) Less(i, j int) bool {
	// 卖盘：价格优先（低→高），时间优先（早→晚）
	if h[i].Price != h[j].Price {
		return h[i].Price < h[j].Price
	}
	return h[i].CreatedAt.Before(h[j].CreatedAt)
}
func (h MinHeap) Swap(i, j int) { h[i], h[j] = h[j], h[i] }

func (h *MinHeap) Push(x any) {
    *h = append(*h, x.(*Order))
}

func (h *MinHeap) Pop() any {
    old := *h
    n := len(old)
    x := old[n-1]
    *h = old[0 : n-1]
    return x
}

// ========== MaxHeap (买盘：价格从高到低) ==========

type MaxHeap []*Order

func (h MaxHeap) Len() int { return len(h) }
func (h MaxHeap) Less(i, j int) bool {
	// 买盘：价格优先（高→低），时间优先（早→晚）
	if h[i].Price != h[j].Price {
		return h[i].Price > h[j].Price
	}
	return h[i].CreatedAt.Before(h[j].CreatedAt)
}
func (h MaxHeap) Swap(i, j int) { h[i], h[j] = h[j], h[i] }

func (h *MaxHeap) Push(x any) {
    *h = append(*h, x.(*Order))
}

func (h *MaxHeap) Pop() any {
    old := *h
    n := len(old)
    x := old[n-1]
    *h = old[0 : n-1]
    return x
}
