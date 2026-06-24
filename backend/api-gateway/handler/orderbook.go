package handler

import (
	"net/http"

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

// GetOrderBook 获取某品种的订单簿（内存撮合引擎中的实时数据）
func (h *OrderBookHandler) GetOrderBook(c *gin.Context) {
	productID := c.Param("product")
	book := h.eng.GetBook(productID)

	book.Mu.RLock()
	buyOrders := make([]*engine.Order, len(*book.BuyHeap))
	sellOrders := make([]*engine.Order, len(*book.SellHeap))
	copy(buyOrders, *book.BuyHeap)
	copy(sellOrders, *book.SellHeap)
	book.Mu.RUnlock()

	c.JSON(http.StatusOK, gin.H{
		"product_id": productID,
		"bids":       buyOrders,
		"asks":       sellOrders,
	})
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
