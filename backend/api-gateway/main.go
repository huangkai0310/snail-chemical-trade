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

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/config"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/db"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/handler"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/middleware"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
	"github.com/huangkai0310/snail-chemical-trade/matching-engine"
)

var (
	eng         *engine.Engine
	broadcast   = make(chan engine.Trade, 128)
	wsClients   = make(map[*websocket.Conn]bool)
	wsRegister  = make(chan *websocket.Conn)
	wsUnregister = make(chan *websocket.Conn)
	upgrader    = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
)

func main() {
	// 日志
	log.Logger = zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339}).
		With().Timestamp().Logger()

	// 加载配置
	cfg := config.Load()

	// 连接数据库
	pool, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("数据库连接失败")
	}
	defer pool.Close()

	// 执行迁移
	if err := db.RunMigrations(pool, ""); err != nil {
		log.Fatal().Err(err).Msg("数据库迁移失败")
	}

	// 初始化 Repo
	userRepo := repo.NewUserRepo(pool)
	productRepo := repo.NewProductRepo(pool)
	listingRepo := repo.NewListingRepo(pool)
	tradeRepo := repo.NewTradeRepo(pool)

	// 初始化撮合引擎
	eng = engine.NewEngine()

	// 初始化 Handler
	authHandler := handler.NewAuthHandler(userRepo, cfg.JWTSecret)
	listingHandler := handler.NewListingHandler(listingRepo, eng, tradeRepo, broadcast)
	orderBookHandler := handler.NewOrderBookHandler(eng, productRepo)

	// 启动 WebSocket 管理器
	go wsManager()

	// 路由
	r := gin.Default()

	// 健康检查
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "time": time.Now().Unix()})
	})

	// Auth 路由组（无需认证）
	auth := r.Group("/api/v1/auth")
	{
		auth.POST("/register", authHandler.Register)
		auth.POST("/login", authHandler.Login)
	}

	// 公开路由
	r.GET("/api/v1/products", orderBookHandler.GetProducts)
	r.GET("/api/v1/orderbook/:product", orderBookHandler.GetOrderBook)

	// 需要认证的路由
	api := r.Group("/api/v1")
	api.Use(middleware.AuthMiddleware(cfg.JWTSecret))
	{
		api.GET("/auth/me", authHandler.Me)
		api.POST("/listings", listingHandler.Create)
		api.GET("/listings", listingHandler.List)
		api.DELETE("/listings/:id", listingHandler.Cancel)
	}

	// WebSocket
	r.GET("/ws", handleWebSocket)

	// 优雅关闭
	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: r,
	}

	go func() {
		log.Info().Str("port", cfg.Port).Msg("🚀 API Gateway 已启动")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("服务启动失败")
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info().Msg("正在关闭服务...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	log.Info().Msg("服务已关闭")
}

// ========== WebSocket ==========

func handleWebSocket(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Error().Err(err).Msg("WebSocket 升级失败")
		return
	}

	wsRegister <- conn

	defer func() {
		wsUnregister <- conn
		conn.Close()
	}()

	// 保持连接
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

func wsManager() {
	for {
		select {
		case conn := <-wsRegister:
			wsClients[conn] = true
			log.Info().Msg("WebSocket 客户端已连接")

		case conn := <-wsUnregister:
			if _, ok := wsClients[conn]; ok {
				delete(wsClients, conn)
				log.Info().Msg("WebSocket 客户端已断开")
			}

		case trade := <-broadcast:
			msg, _ := json.Marshal(trade)
			for client := range wsClients {
				if err := client.WriteMessage(websocket.TextMessage, msg); err != nil {
					client.Close()
					delete(wsClients, client)
				}
			}
		}
	}
}
