// Package engine 提供化工产品现货撮合引擎
//
// 撮合规则：
//   - 价格优先：买单价高者优先，卖单价低者优先
//   - 时间优先：同等价格下，先挂单者优先
//   - 必须实物交割，不可净额结算
//
// 核心数据结构：内存订单簿（双端竞价），通过 Redis 做故障恢复
package engine

import (
    "container/heap"
    "sync"
    "time"

    "github.com/google/uuid"
)

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
    Status    OrderStatus `json:"status"`
    UserID    string      `json:"user_id"`
    CreatedAt time.Time   `json:"created_at"`
    UpdatedAt time.Time   `json:"updated_at"`
}

// Trade 成交记录
type Trade struct {
    ID        string    `json:"id"`
    BuyOrder  string    `json:"buy_order_id"`
    SellOrder string    `json:"sell_order_id"`
    ProductID string    `json:"product_id"`
    Price     float64   `json:"price"`
    Quantity  float64   `json:"quantity"`
    Timestamp time.Time `json:"timestamp"`
}

// OrderBook 订单簿（单个品种）
type OrderBook struct {
    ProductID string
    BuyHeap   *MaxHeap       // 买盘：价格从高到低
    SellHeap  *MinHeap       // 卖盘：价格从低到高
    Mu        sync.RWMutex   // 读写锁
}

// NewOrderBook 创建订单簿
func NewOrderBook(productID string) *OrderBook {
    return &OrderBook{
        ProductID: productID,
        BuyHeap:   &MaxHeap{},
        SellHeap:  &MinHeap{},
    }
}

// NewOrder 创建订单
func NewOrder(productID string, side Side, price, quantity float64, userID string) *Order {
    return &Order{
        ID:        uuid.New().String(),
        ProductID: productID,
        Side:      side,
        Price:     price,
        Quantity:  quantity,
        Status:    StatusOpen,
        UserID:    userID,
        CreatedAt: time.Now(),
        UpdatedAt: time.Now(),
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
    var trades []Trade

    for ob.SellHeap.Len() > 0 && buy.Filled < buy.Quantity {
        bestSell := (*ob.SellHeap)[0]

        // 价格不匹配，停止撮合
        if bestSell.Price > buy.Price {
            break
        }

        // 成交
        matchQty := min(bestSell.Quantity-bestSell.Filled, buy.Quantity-buy.Filled)
        trade := Trade{
            ID:        uuid.New().String(),
            BuyOrder:  buy.ID,
            SellOrder: bestSell.ID,
            ProductID: buy.ProductID,
            Price:     bestSell.Price, // 以卖单价成交
            Quantity:  matchQty,
            Timestamp: time.Now(),
        }

        bestSell.Filled += matchQty
        buy.Filled += matchQty

        if bestSell.Filled >= bestSell.Quantity {
            bestSell.Status = StatusFilled
            heap.Pop(ob.SellHeap)
        } else {
            bestSell.Status = StatusPartial
            heap.Fix(ob.SellHeap, 0)
        }

        trades = append(trades, trade)
    }

    if buy.Filled >= buy.Quantity {
        buy.Status = StatusFilled
    } else if buy.Filled > 0 {
        buy.Status = StatusPartial
    }

    return trades
}

func (ob *OrderBook) matchSell(sell *Order) []Trade {
    var trades []Trade

    for ob.BuyHeap.Len() > 0 && sell.Filled < sell.Quantity {
        bestBuy := (*ob.BuyHeap)[0]

        if bestBuy.Price < sell.Price {
            break
        }

        matchQty := min(bestBuy.Quantity-bestBuy.Filled, sell.Quantity-sell.Filled)
        trade := Trade{
            ID:        uuid.New().String(),
            BuyOrder:  bestBuy.ID,
            SellOrder: sell.ID,
            ProductID: sell.ProductID,
            Price:     bestBuy.Price, // 以买单价成交
            Quantity:  matchQty,
            Timestamp: time.Now(),
        }

        bestBuy.Filled += matchQty
        sell.Filled += matchQty

        if bestBuy.Filled >= bestBuy.Quantity {
            bestBuy.Status = StatusFilled
            heap.Pop(ob.BuyHeap)
        } else {
            bestBuy.Status = StatusPartial
            heap.Fix(ob.BuyHeap, 0)
        }

        trades = append(trades, trade)
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
    books map[string]*OrderBook
    mu    sync.RWMutex
}

// NewEngine 创建撮合引擎
func NewEngine() *Engine {
    return &Engine{
        books: make(map[string]*OrderBook),
    }
}

// GetBook 获取品种订单簿（不存在则创建）
func (e *Engine) GetBook(productID string) *OrderBook {
    e.mu.RLock()
    book, ok := e.books[productID]
    e.mu.RUnlock()

    if !ok {
        e.mu.Lock()
        book = NewOrderBook(productID)
        e.books[productID] = book
        e.mu.Unlock()
    }

    return book
}

// Execute 执行一笔订单，返回成交
func (e *Engine) Execute(order *Order) []Trade {
    book := e.GetBook(order.ProductID)
    return book.PlaceOrder(order)
}
