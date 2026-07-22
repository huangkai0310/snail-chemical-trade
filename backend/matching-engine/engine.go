// Package engine 提供化工产品现货撮合引擎
//
// 撮合规则：
//   - 价格优先：买单价高者优先，卖单价低者优先
//   - 时间优先：同等价格下，先挂单者优先
//   - 必须实物交割，不可净额结算
//
// 核心数据结构：内存订单簿（双端竞价），通过 WAL 日志做故障恢复
//
// 精度说明：
//   价格/数量使用 float64，适用于化工现货场景（价格精度到分、数量精度到0.01吨）。
//   DB 层使用 NUMERIC(12,2)，保证持久化精度。
//   撮合引擎使用 roundDecimal2 辅助函数避免 IEEE754 累积误差。
package engine

import (
    "container/heap"
    "errors"
    "math"
    "sort"
    "sync"
    "time"

    "github.com/google/uuid"
)

var (
	ErrOrderNotFound  = errors.New("order not found in book")
	ErrPriceMismatch  = errors.New("price does not match")
	ErrNoQuantity     = errors.New("no quantity available")
	ErrInvalidSide    = errors.New("invalid taker side for target")
	ErrMinQuantity    = errors.New("quantity below counterparty minimum")
	ErrBlacklisted    = errors.New("counterparty is blacklisted")
)

// BlacklistChecker 黑名单检查接口（由 api-gateway 注入实现）
// 返回 true 表示 takerID 把 makerID 拉黑了，不可成交
type BlacklistChecker interface {
	IsBlocked(takerID, makerID string) bool
}

// roundDecimal2 将浮点数四舍五入到2位小数，避免 IEEE754 累积误差
// 用于所有 Filled / matchQty 更新后的修正
func roundDecimal2(v float64) float64 {
    return math.Round(v*100) / 100
}

// WALAction 操作类型
type WALAction string

const (
    WALPlaceOrder  WALAction = "PLACE_ORDER"
    WALTakeListing WALAction = "TAKE_LISTING"
    WALCancelOrder WALAction = "CANCEL_ORDER"
)

// WALEntry WAL 日志条目
type WALEntry struct {
    ID        string    `json:"id"`
    Action    WALAction `json:"action"`
    OrderID   string    `json:"order_id"`
    ProductID string    `json:"product_id"`
    Side      Side      `json:"side"`
    Price     float64   `json:"price"`
    Quantity  float64   `json:"quantity"`
    UserID    string    `json:"user_id"`
    Timestamp time.Time `json:"timestamp"`
}

// WALWriter WAL 写入接口（由 api-gateway 实现 DB 持久化）
type WALWriter interface {
    Append(entry WALEntry) error
}

// Side 买卖方向
type Side string

const (
    SideBuy  Side = "BUY"
    SideSell Side = "SELL"
)

// OrderStatus 订单状态
type OrderStatus string

const (
    StatusOpen      OrderStatus = "OPEN"
    StatusPartial   OrderStatus = "PARTIAL"
    StatusFilled    OrderStatus = "FILLED"
    StatusCancelled OrderStatus = "CANCELLED"
)

// Order 订单
type Order struct {
    ID        string      `json:"id"`
    ProductID string      `json:"product_id"` // 化工品种：methanol/pta/benzene...
    Side      Side        `json:"side"`
    Price     float64     `json:"price"`     // 单价 (元/吨)
    Quantity  float64     `json:"quantity"`  // 数量 (吨)
    Filled    float64     `json:"filled"`    // 已成交量
	Status     OrderStatus `json:"status"`
	UserID     string      `json:"user_id"`
	MinQuantity  float64 `json:"min_quantity"`  // 最小单笔成交量（对手盘撮合时尊重此下限，0=无限制）
    AllowPartial bool    `json:"allow_partial"` // 是否允许拆单：false 表示必须一次性全部成交，不可部分成交
    // 撮合隔离条款（参考同花顺期货：不同合约/条款的单不自动撮合）
    DeliveryPeriod     string `json:"delivery_period"`      // 交割期
    DeliveryMethod     string `json:"delivery_method"`      // 交割方式：混罐货转/货转/自提/送到...
    FreeStorageEnabled bool   `json:"free_storage_enabled"` // 是否可免仓
    FreeStorageDays    int    `json:"free_storage_days"`    // 免仓天数
    CreatedAt    time.Time `json:"created_at"`
    UpdatedAt    time.Time `json:"updated_at"`
}

// termsMatch 判断两笔订单的撮合条款是否完全一致。
// 参考同花顺期货：交割期 / 交割方式 / 免仓期 任一不同则视为不同合约条款，不自动撮合。
func termsMatch(a, b *Order) bool {
    return a.DeliveryPeriod == b.DeliveryPeriod &&
        a.DeliveryMethod == b.DeliveryMethod &&
        a.FreeStorageEnabled == b.FreeStorageEnabled &&
        a.FreeStorageDays == b.FreeStorageDays
}

// plannedFill 撮合计划：某对手盘拟成交的数量（提交前不修改堆）
type plannedFill struct {
    order *Order
    qty   float64
}

// Trade 成交记录
type Trade struct {
	ID         string    `json:"id"`
	BuyOrder   string    `json:"buy_order_id"`
	SellOrder  string    `json:"sell_order_id"`
	ProductID  string    `json:"product_id"`
	Price      float64   `json:"price"`
	Quantity   float64   `json:"quantity"`
	Timestamp  time.Time `json:"timestamp"`
	Source     string    `json:"source,omitempty"` // 成交来源：auto/take/counter_offer/swap
	BuyUserID  string    `json:"buy_user_id,omitempty"`
	SellUserID string    `json:"sell_user_id,omitempty"`
	// AggressorUserID 主动方（摘牌/议价接受方等）；被动方才应收到「发盘被接」类通知
	AggressorUserID string `json:"aggressor_user_id,omitempty"`
	// ListingUserID 本笔若涉及普通挂牌，则为挂牌方用户 ID（前端按第一人称区分「发盘被接了」vs「换盘/单边成交」）
	ListingUserID string `json:"listing_user_id,omitempty"`
}

// ListingEvent 新挂牌事件，用于实时推送发盘列表刷新（其他用户发盘后及时可见）
type ListingEvent struct {
	ProductID string `json:"product_id"`
}

// OrderBook 订单簿（单个品种）
type OrderBook struct {
    ProductID  string
    BuyHeap    *MaxHeap       // 买盘：价格从高到低
    SellHeap   *MinHeap       // 卖盘：价格从低到高
    Mu         sync.RWMutex   // 读写锁
    blacklist  BlacklistChecker // 可选：黑名单检查器
}

// NewOrderBook 创建订单簿
func NewOrderBook(productID string) *OrderBook {
    return &OrderBook{
        ProductID: productID,
        BuyHeap:   &MaxHeap{},
        SellHeap:  &MinHeap{},
    }
}

// NewOrder 创建订单（仅用于测试；生产环境用 OrderFromListing）
func NewOrder(productID string, side Side, price, quantity float64, userID string) *Order {
	return &Order{
		ID:          uuid.New().String(),
		ProductID:   productID,
		Side:        side,
		Price:       price,
		Quantity:    quantity,
		Status:      StatusOpen,
		UserID:      userID,
		AllowPartial: true, // 测试默认可拆，与生产可拆默认值保持一致
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
}

// OrderFromListing 从挂牌记录构造引擎订单（ID 与 listing 一致）
func OrderFromListing(id, productID, userID string, side Side, price, quantity, filled, minQuantity float64, allowPartial bool, status OrderStatus, createdAt time.Time) *Order {
	return &Order{
		ID:          id,
		ProductID:   productID,
		Side:        side,
		Price:       price,
		Quantity:    quantity,
		Filled:      filled,
		MinQuantity: minQuantity,
		AllowPartial: allowPartial,
		Status:      status,
		UserID:      userID,
		CreatedAt:   createdAt,
		UpdatedAt:   time.Now(),
	}
}

// PlaceOrder 挂单，返回本次产生的成交
func (ob *OrderBook) PlaceOrder(order *Order) []Trade {
    ob.Mu.Lock()
    defer ob.Mu.Unlock()

    var trades []Trade

    if order.Side == SideBuy {
        trades = ob.matchBuy(order)
        if order.Filled < order.Quantity {
            heap.Push(ob.BuyHeap, order)
        }
    } else {
        trades = ob.matchSell(order)
        if order.Filled < order.Quantity {
            heap.Push(ob.SellHeap, order)
        }
    }

    return trades
}

func (ob *OrderBook) matchBuy(buy *Order) []Trade {
	// 计划阶段：按价格/时间优先弹出卖盘，登记可成交计划，暂不修改成交量；
	// 不满足条件（自成交/黑名单/条款不一致/最小单量/对手不可拆）的卖盘暂存后还原。
	var stashed []*Order       // 不合格对手盘（还原回堆）
	var planned []*Order       // 已进入计划的对手盘（已弹出）
	var plan []plannedFill
	var plannedTotal float64
	remaining := roundDecimal2(buy.Quantity - buy.Filled)

	for ob.SellHeap.Len() > 0 && plannedTotal < remaining-1e-9 {
		bestSell := (*ob.SellHeap)[0]

		// 价格不匹配，停止撮合
		if bestSell.Price > buy.Price {
			break
		}

		// 自成交保护：同一用户不能与自己的挂牌成交
		if bestSell.UserID == buy.UserID {
			stashed = append(stashed, bestSell)
			heap.Pop(ob.SellHeap)
			continue
		}

		// 黑名单过滤：买卖任一方拉黑了对方，跳过（双向拦截）
		if ob.blacklist != nil && (ob.blacklist.IsBlocked(buy.UserID, bestSell.UserID) || ob.blacklist.IsBlocked(bestSell.UserID, buy.UserID)) {
			stashed = append(stashed, bestSell)
			heap.Pop(ob.SellHeap)
			continue
		}

		// 撮合隔离：交割期/交割方式/免仓期任一不同则不自动撮合（同花顺期货合约条款隔离）
		if !termsMatch(buy, bestSell) {
			stashed = append(stashed, bestSell)
			heap.Pop(ob.SellHeap)
			continue
		}

		matchQty := roundDecimal2(min(bestSell.Quantity-bestSell.Filled, remaining-plannedTotal))

		// 尊重对手盘最小成交量
		if bestSell.MinQuantity > 0 && matchQty < bestSell.MinQuantity {
			stashed = append(stashed, bestSell)
			heap.Pop(ob.SellHeap)
			continue
		}

		// 尊重对手盘不可拆单：本笔无法一次吃完其剩余量则跳过
		if !bestSell.AllowPartial && matchQty < (bestSell.Quantity-bestSell.Filled)-1e-9 {
			stashed = append(stashed, bestSell)
			heap.Pop(ob.SellHeap)
			continue
		}

		// 操作后剩余量校验：对手盘成交后剩余量若 > 0 但 < 最小单量，则跳过
		sellRemainAfter := (bestSell.Quantity - bestSell.Filled) - matchQty
		sellEffMin := bestSell.MinQuantity
		if sellEffMin <= 0 {
			sellEffMin = 1
		}
		if sellRemainAfter > 1e-9 && sellRemainAfter < sellEffMin-1e-9 {
			stashed = append(stashed, bestSell)
			heap.Pop(ob.SellHeap)
			continue
		}

		// 合格：弹出并登记计划
		heap.Pop(ob.SellHeap)
		planned = append(planned, bestSell)
		plan = append(plan, plannedFill{order: bestSell, qty: matchQty})
		plannedTotal = roundDecimal2(plannedTotal + matchQty)
	}

	canFullyFill := plannedTotal >= remaining-1e-9

	// 主动方不可拆且无法一次性全部成交 -> 取消本次撮合，全部还原，不产生孤儿单
	if !buy.AllowPartial && !canFullyFill {
		for _, o := range planned {
			heap.Push(ob.SellHeap, o)
		}
		for _, o := range stashed {
			heap.Push(ob.SellHeap, o)
		}
		return nil
	}

	// 提交阶段：应用计划成交
	var trades []Trade
	for _, pf := range plan {
		s := pf.order
		s.Filled = roundDecimal2(s.Filled + pf.qty)
		buy.Filled = roundDecimal2(buy.Filled + pf.qty)
		trades = append(trades, Trade{
			ID:         uuid.New().String(),
			BuyOrder:   buy.ID,
			SellOrder:  s.ID,
			ProductID:  buy.ProductID,
			Price:      s.Price, // 以卖单价成交
			Quantity:   pf.qty,
			Timestamp:  time.Now(),
			BuyUserID:  buy.UserID,
			SellUserID: s.UserID,
		})
		if s.Filled >= s.Quantity {
			s.Status = StatusFilled // 已弹出，不再入堆
		} else {
			s.Status = StatusPartial
			heap.Push(ob.SellHeap, s) // 部分成交，剩余量重新入堆
		}
	}

	// 还原不合格对手盘
	for _, o := range stashed {
		heap.Push(ob.SellHeap, o)
	}

	if buy.Filled >= buy.Quantity {
		buy.Status = StatusFilled
	} else if buy.Filled > 0 {
		buy.Status = StatusPartial
	}

	return trades
}

func (ob *OrderBook) matchSell(sell *Order) []Trade {
	var stashed []*Order       // 不合格对手盘（还原回堆）
	var planned []*Order       // 已进入计划的对手盘（已弹出）
	var plan []plannedFill
	var plannedTotal float64
	remaining := roundDecimal2(sell.Quantity - sell.Filled)

	for ob.BuyHeap.Len() > 0 && plannedTotal < remaining-1e-9 {
		bestBuy := (*ob.BuyHeap)[0]

		if bestBuy.Price < sell.Price {
			break
		}

		// 自成交保护：同一用户不能与自己的挂牌成交
		if bestBuy.UserID == sell.UserID {
			stashed = append(stashed, bestBuy)
			heap.Pop(ob.BuyHeap)
			continue
		}

		// 黑名单过滤：买卖任一方拉黑了对方，跳过（双向拦截）
		if ob.blacklist != nil && (ob.blacklist.IsBlocked(sell.UserID, bestBuy.UserID) || ob.blacklist.IsBlocked(bestBuy.UserID, sell.UserID)) {
			stashed = append(stashed, bestBuy)
			heap.Pop(ob.BuyHeap)
			continue
		}

		// 撮合隔离：交割期/交割方式/免仓期任一不同则不自动撮合
		if !termsMatch(sell, bestBuy) {
			stashed = append(stashed, bestBuy)
			heap.Pop(ob.BuyHeap)
			continue
		}

		matchQty := roundDecimal2(min(bestBuy.Quantity-bestBuy.Filled, remaining-plannedTotal))

		// 尊重对手盘最小成交量
		if bestBuy.MinQuantity > 0 && matchQty < bestBuy.MinQuantity {
			stashed = append(stashed, bestBuy)
			heap.Pop(ob.BuyHeap)
			continue
		}

		// 尊重对手盘不可拆单：本笔无法一次吃完其剩余量则跳过
		if !bestBuy.AllowPartial && matchQty < (bestBuy.Quantity-bestBuy.Filled)-1e-9 {
			stashed = append(stashed, bestBuy)
			heap.Pop(ob.BuyHeap)
			continue
		}

		// 操作后剩余量校验：对手盘成交后剩余量若 > 0 但 < 最小单量，则跳过
		buyRemainAfter := (bestBuy.Quantity - bestBuy.Filled) - matchQty
		buyEffMin := bestBuy.MinQuantity
		if buyEffMin <= 0 {
			buyEffMin = 1
		}
		if buyRemainAfter > 1e-9 && buyRemainAfter < buyEffMin-1e-9 {
			stashed = append(stashed, bestBuy)
			heap.Pop(ob.BuyHeap)
			continue
		}

		// 合格：弹出并登记计划
		heap.Pop(ob.BuyHeap)
		planned = append(planned, bestBuy)
		plan = append(plan, plannedFill{order: bestBuy, qty: matchQty})
		plannedTotal = roundDecimal2(plannedTotal + matchQty)
	}

	canFullyFill := plannedTotal >= remaining-1e-9

	// 主动方不可拆且无法一次性全部成交 -> 取消本次撮合，全部还原，不产生孤儿单
	if !sell.AllowPartial && !canFullyFill {
		for _, o := range planned {
			heap.Push(ob.BuyHeap, o)
		}
		for _, o := range stashed {
			heap.Push(ob.BuyHeap, o)
		}
		return nil
	}

	// 提交阶段：应用计划成交
	var trades []Trade
	for _, pf := range plan {
		b := pf.order
		b.Filled = roundDecimal2(b.Filled + pf.qty)
		sell.Filled = roundDecimal2(sell.Filled + pf.qty)
		trades = append(trades, Trade{
			ID:         uuid.New().String(),
			BuyOrder:   b.ID,
			SellOrder:  sell.ID,
			ProductID:  sell.ProductID,
			Price:      b.Price, // 以买单价成交
			Quantity:   pf.qty,
			Timestamp:  time.Now(),
			BuyUserID:  b.UserID,
			SellUserID: sell.UserID,
		})
		if b.Filled >= b.Quantity {
			b.Status = StatusFilled // 已弹出，不再入堆
		} else {
			b.Status = StatusPartial
			heap.Push(ob.BuyHeap, b) // 部分成交，剩余量重新入堆
		}
	}

	// 还原不合格对手盘
	for _, o := range stashed {
		heap.Push(ob.BuyHeap, o)
	}

	if sell.Filled >= sell.Quantity {
		sell.Status = StatusFilled
	} else if sell.Filled > 0 {
		sell.Status = StatusPartial
	}

	return trades
}

// Engine 撮合引擎（管理所有品种的订单簿）
type Engine struct {
    books     map[string]*OrderBook
    mu        sync.RWMutex
    wal       WALWriter        // 可选：WAL日志写入器
    blacklist BlacklistChecker // 可选：黑名单检查器
}

// NewEngine 创建撮合引擎
func NewEngine() *Engine {
    return &Engine{
        books: make(map[string]*OrderBook),
    }
}

// SetWAL 设置 WAL 写入器（api-gateway 启动后调用）
func (e *Engine) SetWAL(w WALWriter) {
    e.wal = w
}

// SetBlacklistChecker 设置黑名单检查器（api-gateway 启动后调用）
func (e *Engine) SetBlacklistChecker(bc BlacklistChecker) {
    e.blacklist = bc
}

// appendWAL 异步写入WAL（失败仅记录不中断主流程）
func (e *Engine) appendWAL(entry WALEntry) {
    if e.wal == nil {
        return
    }
    go func() {
        _ = e.wal.Append(entry)
    }()
}

// GetBook 获取品种订单簿（不存在则创建）
func (e *Engine) GetBook(productID string) *OrderBook {
    e.mu.RLock()
    book, ok := e.books[productID]
    e.mu.RUnlock()

    if !ok {
        e.mu.Lock()
        book = NewOrderBook(productID)
        book.blacklist = e.blacklist // 继承引擎级别的黑名单检查器
        e.books[productID] = book
        e.mu.Unlock()
    }

    return book
}

// ProductIDs 返回当前已加载订单簿的品种 ID
func (e *Engine) ProductIDs() []string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	ids := make([]string, 0, len(e.books))
	for id := range e.books {
		ids = append(ids, id)
	}
	return ids
}

// Execute 执行一笔订单，返回成交
func (e *Engine) Execute(order *Order) []Trade {
    book := e.GetBook(order.ProductID)
    // WAL 记录挂单操作
    e.appendWAL(WALEntry{
        ID:        uuid.New().String(),
        Action:    WALPlaceOrder,
        OrderID:   order.ID,
        ProductID: order.ProductID,
        Side:      order.Side,
        Price:     order.Price,
        Quantity:  order.Quantity,
        UserID:    order.UserID,
        Timestamp: time.Now(),
    })
    return book.PlaceOrder(order)
}

// LoadOrder 将已有挂牌载入订单簿（不触发撮合，用于启动恢复）
func (e *Engine) LoadOrder(order *Order) {
	if order.Filled >= order.Quantity {
		return
	}
	book := e.GetBook(order.ProductID)
	book.loadOrder(order)
}

// RematchProduct 将某品种订单簿清空后按时间重挂，补上「条款对齐但未成交」的对价盘
func (e *Engine) RematchProduct(productID string) []Trade {
	book := e.GetBook(productID)
	book.Mu.Lock()
	orders := make([]*Order, 0, book.BuyHeap.Len()+book.SellHeap.Len())
	for _, o := range *book.BuyHeap {
		orders = append(orders, o)
	}
	for _, o := range *book.SellHeap {
		orders = append(orders, o)
	}
	buy := MaxHeap{}
	sell := MinHeap{}
	book.BuyHeap = &buy
	book.SellHeap = &sell
	heap.Init(book.BuyHeap)
	heap.Init(book.SellHeap)
	book.Mu.Unlock()

	sort.SliceStable(orders, func(i, j int) bool {
		return orders[i].CreatedAt.Before(orders[j].CreatedAt)
	})

	var all []Trade
	for _, o := range orders {
		if o.Filled >= o.Quantity {
			continue
		}
		// 保留已成交量，只对剩余量重新撮合
		all = append(all, e.Execute(o)...)
	}
	return all
}

// TakeListing 摘牌：与指定挂牌直接成交
func (e *Engine) TakeListing(productID, targetOrderID string, taker *Order) ([]Trade, error) {
    book := e.GetBook(productID)
    // WAL 记录摘牌操作
    e.appendWAL(WALEntry{
        ID:        uuid.New().String(),
        Action:    WALTakeListing,
        OrderID:   targetOrderID,
        ProductID: productID,
        Side:      taker.Side,
        Price:     taker.Price,
        Quantity:  taker.Quantity,
        UserID:    taker.UserID,
        Timestamp: time.Now(),
    })
    return book.TakeListing(targetOrderID, taker)
}

// CancelOrder 从订单簿移除挂牌
func (e *Engine) CancelOrder(productID, orderID string) bool {
    book := e.GetBook(productID)
    // WAL 记录撤牌操作
    e.appendWAL(WALEntry{
        ID:        uuid.New().String(),
        Action:    WALCancelOrder,
        OrderID:   orderID,
        ProductID: productID,
        Timestamp: time.Now(),
    })
    return book.RemoveOrder(orderID)
}

func (ob *OrderBook) loadOrder(order *Order) {
    ob.Mu.Lock()
    defer ob.Mu.Unlock()

    if order.Side == SideBuy {
        heap.Push(ob.BuyHeap, order)
    } else {
        heap.Push(ob.SellHeap, order)
    }
}

func (ob *OrderBook) TakeListing(targetOrderID string, taker *Order) ([]Trade, error) {
    ob.Mu.Lock()
    defer ob.Mu.Unlock()

    var target *Order
    var targetHeap heap.Interface
    var targetIdx int

    if taker.Side == SideBuy {
        targetIdx = findOrderIndex(ob.SellHeap, targetOrderID)
        if targetIdx < 0 {
            return nil, ErrOrderNotFound
        }
        target = (*ob.SellHeap)[targetIdx]
        targetHeap = ob.SellHeap
        if target.Price > taker.Price {
            return nil, ErrPriceMismatch
        }
    } else if taker.Side == SideSell {
        targetIdx = findOrderIndex(ob.BuyHeap, targetOrderID)
        if targetIdx < 0 {
            return nil, ErrOrderNotFound
        }
        target = (*ob.BuyHeap)[targetIdx]
        targetHeap = ob.BuyHeap
        if target.Price < taker.Price {
            return nil, ErrPriceMismatch
        }
    } else {
        return nil, ErrInvalidSide
    }

	// 黑名单检查：摘牌方或目标挂牌方任一方拉黑了对方，拒绝成交（双向拦截）
	if ob.blacklist != nil && (ob.blacklist.IsBlocked(taker.UserID, target.UserID) || ob.blacklist.IsBlocked(target.UserID, taker.UserID)) {
		return nil, ErrBlacklisted
	}

	matchQty := roundDecimal2(min(target.Quantity-target.Filled, taker.Quantity-taker.Filled))
	if matchQty <= 0 {
		return nil, ErrNoQuantity
	}

	// 尊重对手盘最小成交量：若本次摘牌量低于对手盘最小单量、且未全部吃完对手盘余量，则拒绝
	// （若本笔即可把对手盘余量全部吃掉，则允许清算剩余量，避免挂牌永久卡死）
	if target.MinQuantity > 0 && matchQty < target.MinQuantity && (target.Quantity-target.Filled) > matchQty+1e-9 {
		return nil, ErrMinQuantity
	}

	// 尊重对手盘不可拆单：若对手盘不允许拆单且本笔无法一次吃完其剩余量，则拒绝
	if !target.AllowPartial && (target.Quantity-target.Filled) > matchQty+1e-9 {
		return nil, ErrMinQuantity
	}

	// 操作后剩余量校验：摘牌后对手盘剩余量若 > 0 但 < 最小单量，则拒绝
	// （全部吃光则允许，避免挂牌永久卡死）
	targetRemainAfter := (target.Quantity - target.Filled) - matchQty
	effectiveMin := target.MinQuantity
	if effectiveMin <= 0 {
		effectiveMin = 1
	}
	if targetRemainAfter > 1e-9 && targetRemainAfter < effectiveMin-1e-9 {
		return nil, ErrMinQuantity
	}

    var buyID, sellID, buyUID, sellUID string
    if taker.Side == SideBuy {
        buyID, sellID = taker.ID, target.ID
        buyUID, sellUID = taker.UserID, target.UserID
    } else {
        buyID, sellID = target.ID, taker.ID
        buyUID, sellUID = target.UserID, taker.UserID
    }

    trade := Trade{
        ID:         uuid.New().String(),
        BuyOrder:   buyID,
        SellOrder:  sellID,
        ProductID:  taker.ProductID,
        Price:      target.Price,
        Quantity:   matchQty,
        Timestamp:  time.Now(),
        BuyUserID:  buyUID,
        SellUserID: sellUID,
    }

    target.Filled = roundDecimal2(target.Filled + matchQty)
    taker.Filled = roundDecimal2(taker.Filled + matchQty)

    if target.Filled >= target.Quantity {
        target.Status = StatusFilled
        heap.Remove(targetHeap, targetIdx)
    } else {
        target.Status = StatusPartial
        heap.Fix(targetHeap, targetIdx)
    }

    if taker.Filled >= taker.Quantity {
        taker.Status = StatusFilled
    } else if taker.Filled > 0 {
        taker.Status = StatusPartial
    }

    return []Trade{trade}, nil
}

func (ob *OrderBook) RemoveOrder(orderID string) bool {
    ob.Mu.Lock()
    defer ob.Mu.Unlock()

    if idx := findOrderIndex(ob.BuyHeap, orderID); idx >= 0 {
        heap.Remove(ob.BuyHeap, idx)
        return true
    }
    if idx := findOrderIndex(ob.SellHeap, orderID); idx >= 0 {
        heap.Remove(ob.SellHeap, idx)
        return true
    }
    return false
}

func findOrderIndex(h heap.Interface, orderID string) int {
    for i := 0; i < h.Len(); i++ {
        var id string
        switch heap := h.(type) {
        case *MaxHeap:
            id = (*heap)[i].ID
        case *MinHeap:
            id = (*heap)[i].ID
        }
        if id == orderID {
            return i
        }
    }
    return -1
}
