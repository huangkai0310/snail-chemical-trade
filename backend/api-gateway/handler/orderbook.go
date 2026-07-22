package handler

import (
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
	"github.com/huangkai0310/snail-chemical-trade/matching-engine"
)

type OrderBookHandler struct {
	eng         *engine.Engine
	productRepo *repo.ProductRepo
}

func NewOrderBookHandler(eng *engine.Engine, productRepo *repo.ProductRepo) *OrderBookHandler {
	return &OrderBookHandler{eng: eng, productRepo: productRepo}
}

// DepthLevel 价格档位聚合深度
type DepthLevel struct {
	Price       float64 `json:"price"`
	Quantity    float64 `json:"quantity"`     // 该价位的剩余总量
	OrderCount  int     `json:"order_count"`  // 该价位的挂单数
	Cumulative  float64 `json:"cumulative"`   // 累计深度
}

// GetOrderBook 获取某品种的订单簿（内存撮合引擎中的实时数据）
func (h *OrderBookHandler) GetOrderBook(c *gin.Context) {
	productID := c.Param("product")
	deliveryPeriod := c.Query("delivery_period")
	book := h.eng.GetBook(productID)

	book.Mu.RLock()
	allBuyOrders := make([]*engine.Order, len(*book.BuyHeap))
	allSellOrders := make([]*engine.Order, len(*book.SellHeap))
	copy(allBuyOrders, *book.BuyHeap)
	copy(allSellOrders, *book.SellHeap)
	book.Mu.RUnlock()

	// 按交割期过滤
	buyOrders := allBuyOrders
	sellOrders := allSellOrders
	if deliveryPeriod != "" {
		buyOrders = filterByDeliveryPeriod(allBuyOrders, deliveryPeriod)
		sellOrders = filterByDeliveryPeriod(allSellOrders, deliveryPeriod)
	}

	// 按价格聚合深度
	bidDepth := aggregateDepth(buyOrders, true)
	askDepth := aggregateDepth(sellOrders, false)

	// 计算累计深度
	var cum float64
	for i := range bidDepth {
		cum += bidDepth[i].Quantity
		bidDepth[i].Cumulative = cum
	}
	cum = 0
	for i := range askDepth {
		cum += askDepth[i].Quantity
		askDepth[i].Cumulative = cum
	}

	c.JSON(http.StatusOK, gin.H{
		"product_id":  productID,
		"bids":        buyOrders,
		"asks":        sellOrders,
		"bid_depth":   bidDepth,
		"ask_depth":   askDepth,
	})
}

// filterByDeliveryPeriod 按交割期过滤订单（空/现货等价；远期精确匹配）
func filterByDeliveryPeriod(orders []*engine.Order, deliveryPeriod string) []*engine.Order {
	period := strings.TrimSpace(deliveryPeriod)
	if period == "" {
		period = "现货"
	}
	wantSpot := period == "现货"
	var filtered []*engine.Order
	for _, o := range orders {
		op := strings.TrimSpace(o.DeliveryPeriod)
		oSpot := op == "" || op == "现货"
		if wantSpot {
			if oSpot {
				filtered = append(filtered, o)
			}
			continue
		}
		if op == period {
			filtered = append(filtered, o)
		}
	}
	return filtered
}

// aggregateDepth 将订单按价格档位聚合
func aggregateDepth(orders []*engine.Order, isBuy bool) []DepthLevel {
	priceMap := make(map[float64]*DepthLevel)
	for _, o := range orders {
		remaining := o.Quantity - o.Filled
		if remaining <= 0 {
			continue
		}
		if level, ok := priceMap[o.Price]; ok {
			level.Quantity += remaining
			level.OrderCount++
		} else {
			priceMap[o.Price] = &DepthLevel{
				Price:      o.Price,
				Quantity:   remaining,
				OrderCount: 1,
			}
		}
	}

	levels := make([]DepthLevel, 0, len(priceMap))
	for _, l := range priceMap {
		levels = append(levels, *l)
	}

	if isBuy {
		sort.Slice(levels, func(i, j int) bool { return levels[i].Price > levels[j].Price })
	} else {
		sort.Slice(levels, func(i, j int) bool { return levels[i].Price < levels[j].Price })
	}

	// 限制返回档位数
	if len(levels) > 20 {
		levels = levels[:20]
	}

	return levels
}

// GetProducts 获取品种列表
func (h *OrderBookHandler) GetProducts(c *gin.Context) {
	products, err := h.productRepo.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	c.JSON(http.StatusOK, products)
}

