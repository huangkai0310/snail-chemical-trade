package main

import (
    "context"
    "encoding/json"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/gin-gonic/gin"
    "github.com/gorilla/websocket"
    "github.com/rs/zerolog"
    "github.com/rs/zerolog/log"

    "github.com/huangkai0310/snail-chemical-trade/matching-engine"
)

var (
    engine *engine.Engine
    upgrader = websocket.Upgrader{
        CheckOrigin: func(r *http.Request) bool { return true },
    }
    wsClients = make(map[*websocket.Conn]bool)
    broadcast = make(chan engine.Trade, 64)
)

func main() {
    // 日志
    log.Logger = zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr}).With().Timestamp().Logger()

    // 初始化撮合引擎
    engine = engine.NewEngine()

    // 启动 WebSocket 广播
    go wsBroadcaster()

    // 路由
    r := gin.Default()

    // 健康检查
    r.GET("/health", func(c *gin.Context) {
        c.JSON(200, gin.H{"status": "ok", "time": time.Now().Unix()})
    })

    // API v1
    v1 := r.Group("/api/v1")
    {
        // 挂牌
        v1.POST("/orders", placeOrder)
        // 查询订单簿
        v1.GET("/orderbook/:product", getOrderBook)
        // 品种列表
        v1.GET("/products", getProducts)
    }

    // WebSocket 实时推送
    r.GET("/ws", handleWebSocket)

    // 优雅关闭
    srv := &http.Server{
        Addr:    ":8080",
        Handler: r,
    }

    go func() {
        log.Info().Msg("API Gateway starting on :8080")
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatal().Err(err).Msg("server error")
        }
    }()

    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit

    log.Info().Msg("Shutting down...")
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    srv.Shutdown(ctx)
}

// ===== Handlers =====

type PlaceOrderReq struct {
    ProductID string  `json:"product_id" binding:"required"`
    Side      string  `json:"side" binding:"required,oneof=BUY SELL"`
    Price     float64 `json:"price" binding:"required,gt=0"`
    Quantity  float64 `json:"quantity" binding:"required,gt=0"`
    UserID    string  `json:"user_id" binding:"required"`
}

func placeOrder(c *gin.Context) {
    var req PlaceOrderReq
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(400, gin.H{"error": err.Error()})
        return
    }

    order := engine.NewOrder(req.ProductID, engine.Side(req.Side), req.Price, req.Quantity, req.UserID)
    trades := engine.Execute(order)

    // 广播成交
    for _, t := range trades {
        broadcast <- t
    }

    c.JSON(200, gin.H{
        "order":  order,
        "trades": trades,
    })
}

func getOrderBook(c *gin.Context) {
    productID := c.Param("product")
    book := engine.GetBook(productID)

	book.Mu.RLock()
	buyOrders := make([]*engine.Order, len(*book.BuyHeap))
	sellOrders := make([]*engine.Order, len(*book.SellHeap))
	copy(buyOrders, *book.BuyHeap)
	copy(sellOrders, *book.SellHeap)
	book.Mu.RUnlock()

    c.JSON(200, gin.H{
        "product_id": productID,
        "bids":       buyOrders,
        "asks":       sellOrders,
    })
}

func getProducts(c *gin.Context) {
    products := []gin.H{
        {"id": "methanol", "name": "甲醇", "unit": "吨"},
        {"id": "pta", "name": "PTA", "unit": "吨"},
        {"id": "benzene", "name": "纯苯", "unit": "吨"},
        {"id": "ethylene_glycol", "name": "乙二醇", "unit": "吨"},
        {"id": "styrene", "name": "苯乙烯", "unit": "吨"},
    }
    c.JSON(200, products)
}

// ===== WebSocket =====

func handleWebSocket(c *gin.Context) {
    conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
    if err != nil {
        log.Error().Err(err).Msg("ws upgrade failed")
        return
    }

    wsClients[conn] = true
    defer func() {
        delete(wsClients, conn)
        conn.Close()
    }()

    log.Info().Msg("WebSocket client connected")

    for {
        _, _, err := conn.ReadMessage()
        if err != nil {
            break
        }
    }
}

func wsBroadcaster() {
    for trade := range broadcast {
        msg, _ := json.Marshal(trade)
        for client := range wsClients {
            client.WriteMessage(websocket.TextMessage, msg)
        }
    }
}
