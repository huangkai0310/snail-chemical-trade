package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/calendar"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/config"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/db"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/handler"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/middleware"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/scheduler"
	engine "github.com/huangkai0310/snail-chemical-trade/matching-engine"
)

// wsClientInfo 一个 WS 连接及其归属的 user
type wsClientInfo struct {
	conn   *websocket.Conn
	userID uuid.UUID
}

var (
	eng              *engine.Engine
	broadcast        = make(chan engine.Trade, 128)
	listingBroadcast = make(chan engine.ListingEvent, 128)
	marketBroadcast  = make(chan handler.MarketStatusEvent, 32)
	contractBroadcast = make(chan handler.ContractsChangedEvent, 64)
	wsRegister       = make(chan wsClientInfo)
	wsUnregister     = make(chan wsClientInfo)

	// wsUserConns: user_id → 该用户所有 WS 连接（支持多 Tab）
	wsUserConns   = make(map[uuid.UUID][]*websocket.Conn)
	wsUserConnsMu sync.RWMutex // 仅供 wsPush 读取使用，写由 wsManager 完成

	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	jwtSecretGlobal string
)

func main() {
	// 日志
	log.Logger = zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339}).
		With().Timestamp().Logger()

	// 加载配置
	cfg := config.Load()
	jwtSecretGlobal = cfg.JWTSecret

	// 连接数据库
	pool, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("数据库连接失败")
	}
	defer pool.Close()

	// 执行迁移
	if err := db.RunMigrations(pool, cfg.MigrationsDir); err != nil {
		log.Fatal().Err(err).Msg("数据库迁移失败")
	}

	// 初始化 Repo
	userRepo := repo.NewUserRepo(pool)
	productRepo := repo.NewProductRepo(pool)
	listingRepo := repo.NewListingRepo(pool)
	tradeRepo := repo.NewTradeRepo(pool)
	accountRepo := repo.NewAccountRepo(pool)
	counterOfferRepo := repo.NewCounterOfferRepo(pool)
	blacklistRepo := repo.NewBlacklistRepo(pool)
	preferencesRepo := repo.NewPreferencesRepo(pool)
	indicatorCacheRepo := repo.NewIndicatorCacheRepo(pool)

	// 初始化 Admin Repo
	holidayRepo := repo.NewHolidayRepo(pool)
	marketConfigRepo := repo.NewMarketConfigRepo(pool)
	cronTaskRepo := repo.NewCronTaskRepo(pool)

	// 初始化日历服务：节假日从数据库读取（fallback 到内置 2025-2026 数据）
	calendar.SetGlobalCalendarService(holidayRepo)

	// 初始化撮合引擎
	eng = engine.NewEngine()

	// 初始化 WAL 日志（持久化撮合操作）
	walRepo := repo.NewWALRepo(pool)
	eng.SetWAL(walRepo)

	// 初始化黑名单检查器并注入撮合引擎（撮合时自动过滤被拉黑的对手盘）
	blacklistChecker := handler.NewBlacklistCheckerImpl(pool)
	eng.SetBlacklistChecker(blacklistChecker)

	// 从数据库恢复活跃挂牌到订单簿
	if err := reloadOrderBook(context.Background(), listingRepo, eng); err != nil {
		log.Fatal().Err(err).Msg("订单簿恢复失败")
	}

	// 初始化 Handler
	authHandler := handler.NewAuthHandler(userRepo, cfg.JWTSecret)
	listingHandler := handler.NewListingHandler(listingRepo, eng, tradeRepo, accountRepo, broadcast, listingBroadcast)
	orderBookHandler := handler.NewOrderBookHandler(eng, productRepo)
	tradeHandler := handler.NewTradeHandler(tradeRepo)
	accountHandler := handler.NewAccountHandler(accountRepo)
	swapHandler := handler.NewSwapHandler(pool)
	swapHandler.SetTradeRepo(tradeRepo)
	swapHandler.SetBroadcast(broadcast)
	counterOfferHandler := handler.NewCounterOfferHandler(counterOfferRepo, listingRepo, tradeRepo, accountRepo, pool, eng, broadcast)
	blacklistHandler := handler.NewBlacklistHandler(blacklistRepo, userRepo)
	preferencesHandler := handler.NewPreferencesHandler(preferencesRepo)
	indicatorCacheHandler := handler.NewIndicatorCacheHandler(indicatorCacheRepo)

	// 初始化 Admin Handlers
	adminDictHandler := handler.NewAdminDictHandler(pool)
	adminProductHandler := handler.NewAdminProductHandler(productRepo)
	adminHolidayHandler := handler.NewAdminHolidayHandler(holidayRepo)
	adminMarketConfigHandler := handler.NewAdminMarketConfigHandler(marketConfigRepo)
	adminMarketConfigHandler.SetMarketBroadcast(marketBroadcast)
	adminCronTaskHandler := handler.NewAdminCronTaskHandler(cronTaskRepo)

	// 注入议价 Repo 到 listingHandler 和 swapHandler（用于撤盘/成交时自动取消关联 PENDING 议价）
	listingHandler.SetCounterOfferRepo(counterOfferRepo)
	swapHandler.SetCounterOfferRepo(counterOfferRepo)
	// 注入黑名单 Repo 到 listingHandler 和 swapHandler（用于摘牌/换盘还盘前检查黑名单 + 列表标记）
	listingHandler.SetBlacklistRepo(blacklistRepo)
	swapHandler.SetBlacklistRepo(blacklistRepo)
	// 注入市场配置 Repo（用于闭市时拒绝新挂牌/摘盘/换盘发布/换盘成交）
	listingHandler.SetMarketConfigRepo(marketConfigRepo)
	swapHandler.SetMarketConfigRepo(marketConfigRepo)
	// 品种+交割期合约：首次发布时建立
	contractRepo := repo.NewProductContractRepo(pool)
	contractHandler := handler.NewContractHandler(contractRepo)
	contractHandler.SetPreferencesRepo(preferencesRepo)
	contractHandler.SetListingRepo(listingRepo)
	contractHandler.SetContractBroadcast(contractBroadcast)
	contractHandler.SetListingBroadcast(listingBroadcast)
	listingHandler.SetContractRepo(contractRepo)
	swapHandler.SetContractRepo(contractRepo)
	listingHandler.SetContractBroadcast(contractBroadcast)
	swapHandler.SetContractBroadcast(contractBroadcast)
	listingHandler.SetPreferencesRepo(preferencesRepo)
	swapHandler.SetPreferencesRepo(preferencesRepo)
	// 注入 pool 和 wsPush 到 listingHandler（用于 #697-6 普通挂牌→换盘锁单撮合）
	listingHandler.SetPool(pool)
	listingHandler.SetWSPush(func(targetUserID uuid.UUID, msgType string, payload interface{}) {
		msg, _ := json.Marshal(wsBroadcastMsg{Type: msgType, Payload: payload})
		wsUserConnsMu.RLock()
		conns := wsUserConns[targetUserID]
		wsUserConnsMu.RUnlock()
		for _, conn := range conns {
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				log.Error().Err(err).Str("user_id", targetUserID.String()).Msg("WebSocket 推送失败")
			}
		}
	})
	// 注入 listingBroadcast 通道到 swapHandler（用于换盘增删改时推送实时刷新事件）
	swapHandler.SetListingBroadcast(listingBroadcast)
	// 注入 listingRepo 到 swapHandler（用于换盘锁单与普通挂牌自动撮合）
	swapHandler.SetListingRepo(listingRepo)
	// 换盘创建后：剩余买/卖腿与同条款挂牌自动撮合
	swapHandler.SetAfterCreateMatch(func(ctx context.Context, swapID uuid.UUID) {
		listingHandler.MatchOpenSwapWithListings(ctx, swapID)
	})
	// 启动后回补存量：换盘↔挂牌；以及普通挂牌对价盘（编辑未重撮等）
	go func() {
		time.Sleep(2 * time.Second)
		listingHandler.ReconcileSwapListingCrossMatches(context.Background())
		listingHandler.RematchOpenListingBooks(context.Background())
	}()
	// 注入 WebSocket 推送（换盘单边锁定通知）
	swapHandler.SetWSPush(func(targetUserID uuid.UUID, msgType string, payload interface{}) {
		msg, _ := json.Marshal(wsBroadcastMsg{Type: msgType, Payload: payload})
		wsUserConnsMu.RLock()
		conns := wsUserConns[targetUserID]
		wsUserConnsMu.RUnlock()
		for _, conn := range conns {
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				log.Error().Err(err).Str("user_id", targetUserID.String()).Msg("WebSocket 推送失败")
			}
		}
	})
	// 注入黑名单 Repo 到 counterOfferHandler（用于发起/接受议价前检查黑名单）
	counterOfferHandler.SetBlacklistRepo(blacklistRepo)
	// 注入 WebSocket 推送函数（用于议价通知：收到议价/被接受/被拒绝/被撤销）
	counterOfferHandler.SetWSPush(func(targetUserID uuid.UUID, msgType string, payload interface{}) {
		msg, _ := json.Marshal(wsBroadcastMsg{Type: msgType, Payload: payload})
		wsUserConnsMu.RLock()
		conns := wsUserConns[targetUserID]
		wsUserConnsMu.RUnlock()
		for _, conn := range conns {
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				log.Error().Err(err).Str("user_id", targetUserID.String()).Msg("WebSocket 推送失败")
			}
		}
	})

	// 启动 WebSocket 管理器
	go wsManager()

	// 启动动态定时任务调度器（从 cron_tasks 表读取配置，支持后台管理界面增删改查/启停）
	sched := scheduler.NewScheduler(cronTaskRepo)
	sched.Register("expire_listings", func(ctx context.Context) error {
		listingHandler.ExpireListings()
		listingHandler.ActivateScheduled()
		listingHandler.NotifyScheduleReminders()
		if swapHandler != nil {
			swapHandler.ExpireSwaps()
			swapHandler.ActivateScheduled()
			swapHandler.NotifyScheduleReminders()
		}
		return nil
	})
	sched.Register("expire_counter_offers", func(ctx context.Context) error {
		counterOfferHandler.ExpirePending()
		return nil
	})
	sched.Register("purge_past_contracts", func(ctx context.Context) error {
		contractHandler.PurgePastContracts()
		return nil
	})
	sched.Register("collect_market_data", func(ctx context.Context) error {
		return handler.CollectMarketData(ctx, cfg.CrawlerScriptPath, cfg.CrawlerPythonBin)
	})
	sched.Start()

	// 路由
	r := gin.Default()
	r.Use(middleware.CORS())

	// 健康检查
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "time": time.Now().Unix()})
	})

	// Auth 路由组（无需认证，但限流防刷）
	auth := r.Group("/api/v1/auth")
	auth.Use(middleware.RateLimit(2, 5)) // 每秒2请求，突发上限5
	{
		auth.POST("/register", authHandler.Register)
		auth.POST("/login", authHandler.Login)
	}

	// 公开路由
	r.GET("/api/v1/products", orderBookHandler.GetProducts)
	r.GET("/api/v1/products/:id/contracts", contractHandler.ListByProduct)
	r.GET("/api/v1/contracts", contractHandler.ListAll)
	r.GET("/api/v1/market-status", adminMarketConfigHandler.GetMarketStatus)
	r.GET("/api/v1/orderbook/:product", orderBookHandler.GetOrderBook)
	r.GET("/api/v1/trades", tradeHandler.List)
	r.GET("/api/v1/trades/price-history", tradeHandler.PriceHistory)
	r.GET("/api/v1/trades/latest-price", tradeHandler.LatestPrice)
	// 盘子详情（公开，无需认证，用独立前缀避免与 /listings/:id 路由冲突）
	r.GET("/api/v1/listing-detail/:id", listingHandler.GetByID)
	r.GET("/api/v1/swap-detail/:id", swapHandler.GetByID)

	// 指标缓存（公开，行情数据）
	r.POST("/api/v1/indicators", indicatorCacheHandler.Upsert)
	r.GET("/api/v1/indicators", indicatorCacheHandler.Get)
	r.GET("/api/v1/indicators/list", indicatorCacheHandler.List)
	r.DELETE("/api/v1/indicators", indicatorCacheHandler.Delete)

	// 需要认证的路由
	api := r.Group("/api/v1")
	api.Use(middleware.AuthMiddleware(cfg.JWTSecret))
	api.Use(middleware.RateLimit(10, 20)) // 每秒10请求，突发上限20
	{
		api.GET("/auth/me", authHandler.Me)
		api.POST("/listings", listingHandler.Create)
		api.POST("/listings/:id/take", listingHandler.Take)
		api.GET("/listings", listingHandler.List)
		api.GET("/listings/mine", listingHandler.MyListings)
		api.PATCH("/listings/:id", listingHandler.Update)
		api.DELETE("/listings/:id", listingHandler.Cancel)
		// 我的成交（需认证）
		api.GET("/trades/mine", tradeHandler.MyTrades)
		// 资金账户
		api.GET("/account", accountHandler.GetAccount)
		api.POST("/account/deposit", accountHandler.Deposit)
		api.POST("/account/withdraw", accountHandler.Withdraw)
		api.GET("/account/transactions", accountHandler.ListTransactions)
		// 换盘
		api.POST("/swaps", swapHandler.Create)
		api.GET("/swaps", swapHandler.List)
		api.GET("/swaps/mine", swapHandler.MySwaps)
		api.PUT("/swaps/:id", swapHandler.Update)
		api.POST("/swaps/:id/match", swapHandler.Match)
		api.GET("/swaps/:id/pending-locks", swapHandler.ListPendingLocks)
		api.DELETE("/swaps/:id", swapHandler.Cancel)
		api.GET("/swap-matches/mine", swapHandler.ListMyLocks)
		api.DELETE("/swap-matches/:id/lock", swapHandler.CancelLock)
		// 议价
		api.POST("/counter-offers", counterOfferHandler.Create)
		api.GET("/counter-offers/received", counterOfferHandler.ListReceived)
		api.GET("/counter-offers/sent", counterOfferHandler.ListSent)
		api.GET("/counter-offers/by-ref", counterOfferHandler.ListByRef)
		api.POST("/counter-offers/:id/accept", counterOfferHandler.Accept)
		api.POST("/counter-offers/:id/respond", counterOfferHandler.Respond)
		api.POST("/counter-offers/:id/reject", counterOfferHandler.Reject)
		api.POST("/counter-offers/:id/cancel", counterOfferHandler.Cancel)
		api.PATCH("/counter-offers/:id", counterOfferHandler.Update)
		// 黑名单
		api.GET("/blacklist", blacklistHandler.List)
		api.POST("/blacklist", blacklistHandler.Add)
		api.DELETE("/blacklist/:id", blacklistHandler.Remove)
		// 用户搜索（黑名单模糊匹配公司名/用户名）
		api.GET("/users/search", blacklistHandler.SearchUsers)
		// 用户偏好（自选 / 交易大厅记忆，跨端同步）
		api.GET("/preferences", preferencesHandler.Get)
		api.PUT("/preferences", preferencesHandler.Update)
	}

	// Admin 路由（需要认证 + 管理员权限）
	admin := r.Group("/api/v1/admin")
	admin.Use(middleware.AuthMiddleware(cfg.JWTSecret))
	admin.Use(middleware.AdminMiddleware(userRepo))
	{
		// 原有过期挂牌清理
		admin.POST("/expire-listings", listingHandler.ExpireListingsHandler)

		// 品种管理
		admin.GET("/products", adminProductHandler.List)
		admin.POST("/products", adminProductHandler.Create)
		admin.PUT("/products/:id", adminProductHandler.Update)
		admin.DELETE("/products/:id", adminProductHandler.Delete)

		// 字典表管理（6种字典类型通过 dictType 路径参数区分）
		// dictType: delivery-periods | delivery-locations | product-specs | payment-methods | delivery-methods | free-storage
		admin.GET("/dict/:dictType", adminDictHandler.List)
		admin.POST("/dict/:dictType", adminDictHandler.Create)
		admin.PUT("/dict/:dictType/:id", adminDictHandler.Update)
		admin.DELETE("/dict/:dictType/:id", adminDictHandler.Delete)

		// 节假日管理
		admin.GET("/holidays", adminHolidayHandler.List)
		admin.POST("/holidays", adminHolidayHandler.Create)
		admin.PUT("/holidays/:id", adminHolidayHandler.Update)
		admin.DELETE("/holidays/:id", adminHolidayHandler.Delete)
		admin.POST("/holidays/batch", adminHolidayHandler.BatchUpsert)
		admin.DELETE("/holidays/year/:year", adminHolidayHandler.DeleteByYear)

		// 市场配置管理
		admin.GET("/market-config", adminMarketConfigHandler.List)
		admin.GET("/market-config/:key", adminMarketConfigHandler.Get)
		admin.PUT("/market-config/:key", adminMarketConfigHandler.Set)
		admin.DELETE("/market-config/:key", adminMarketConfigHandler.Delete)

		// 市场开闭市开关
		admin.GET("/market-status", adminMarketConfigHandler.GetMarketStatus)
		admin.PUT("/market-status", adminMarketConfigHandler.SetMarketStatus)

		// 定时任务管理
		admin.GET("/cron-tasks", adminCronTaskHandler.List)
		admin.POST("/cron-tasks", adminCronTaskHandler.Create)
		admin.PUT("/cron-tasks/:id", adminCronTaskHandler.Update)
		admin.DELETE("/cron-tasks/:id", adminCronTaskHandler.Delete)
		admin.PUT("/cron-tasks/:id/toggle", adminCronTaskHandler.Toggle)
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

func reloadOrderBook(ctx context.Context, listingRepo *repo.ListingRepo, eng *engine.Engine) error {
	listings, err := listingRepo.ListActive(ctx)
	if err != nil {
		return err
	}
	for _, l := range listings {
		if l.Filled >= l.Quantity {
			continue
		}
		order := engine.OrderFromListing(
			l.ID.String(), l.ProductID, l.UserID.String(),
			engine.Side(l.Side), l.Price, l.Quantity, l.Filled, l.MinQuantity, l.AllowPartial,
			engine.OrderStatus(l.Status), l.CreatedAt,
		)
		// 撮合隔离条款：交割期 / 交割方式 / 免仓期（恢复订单簿时同步）
		if l.DeliveryPeriod != nil {
			order.DeliveryPeriod = *l.DeliveryPeriod
		}
		if l.DeliveryMethod != nil {
			order.DeliveryMethod = *l.DeliveryMethod
		}
		order.FreeStorageEnabled = l.FreeStorageEnabled
		if l.FreeStorageDays != nil {
			order.FreeStorageDays = *l.FreeStorageDays
		}
		eng.LoadOrder(order)
	}
	log.Info().Int("count", len(listings)).Msg("订单簿已从数据库恢复")
	return nil
}

// ========== WebSocket ==========

func handleWebSocket(c *gin.Context) {
	// WebSocket 认证：优先从 query param token 取，也支持 Authorization header
	tokenStr := c.Query("token")
	if tokenStr == "" {
		authHeader := c.GetHeader("Authorization")
		if parts := strings.SplitN(authHeader, " ", 2); len(parts) == 2 && parts[0] == "Bearer" {
			tokenStr = parts[1]
		}
	}
	if tokenStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "缺少认证令牌"})
		return
	}

	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return []byte(jwtSecretGlobal), nil
	})
	if err != nil || !token.Valid {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "令牌无效或已过期"})
		return
	}

	// 从 JWT claims 解析 user_id（与 middleware/auth.go 保持一致，key 为 "user_id"）
	var userID uuid.UUID
	if claims, ok := token.Claims.(jwt.MapClaims); ok {
		if uidStr, ok := claims["user_id"].(string); ok {
			if id, err := uuid.Parse(uidStr); err == nil {
				userID = id
			}
		}
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Error().Err(err).Msg("WebSocket 升级失败")
		return
	}

	info := wsClientInfo{conn: conn, userID: userID}
	wsRegister <- info

	defer func() {
		wsUnregister <- info
		conn.Close()
	}()

	// 保持连接（ping/pong 维活）
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	for {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

// wsBroadcastMsg 广播给全部连接的消息（成交推送）
type wsBroadcastMsg struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

func broadcastAll(connUser map[*websocket.Conn]uuid.UUID, msg []byte) {
	for conn := range connUser {
		if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			conn.Close()
			uid := connUser[conn]
			delete(connUser, conn)
			wsUserConnsMu.Lock()
			conns := wsUserConns[uid]
			newConns := make([]*websocket.Conn, 0, len(conns))
			for _, c := range conns {
				if c != conn {
					newConns = append(newConns, c)
				}
			}
			if len(newConns) == 0 {
				delete(wsUserConns, uid)
			} else {
				wsUserConns[uid] = newConns
			}
			wsUserConnsMu.Unlock()
		}
	}
}

func wsManager() {
	// 内部维护 conn → userID 映射，避免遍历时加锁
	connUser := make(map[*websocket.Conn]uuid.UUID)

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case info := <-wsRegister:
			connUser[info.conn] = info.userID
			// 更新 wsUserConns（需加写锁）
			wsUserConnsMu.Lock()
			wsUserConns[info.userID] = append(wsUserConns[info.userID], info.conn)
			wsUserConnsMu.Unlock()
			log.Info().Str("user_id", info.userID.String()).Msg("WebSocket 客户端已连接")

		case info := <-wsUnregister:
			delete(connUser, info.conn)
			// 从 wsUserConns 中移除该连接
			wsUserConnsMu.Lock()
			conns := wsUserConns[info.userID]
			newConns := make([]*websocket.Conn, 0, len(conns))
			for _, c := range conns {
				if c != info.conn {
					newConns = append(newConns, c)
				}
			}
			if len(newConns) == 0 {
				delete(wsUserConns, info.userID)
			} else {
				wsUserConns[info.userID] = newConns
			}
			wsUserConnsMu.Unlock()
			log.Info().Str("user_id", info.userID.String()).Msg("WebSocket 客户端已断开")

		case trade := <-broadcast:
			// 广播成交消息给所有连接
			msg, _ := json.Marshal(wsBroadcastMsg{Type: "trade", Payload: trade})
			for conn := range connUser {
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					conn.Close()
					uid := connUser[conn]
					delete(connUser, conn)
					// 同步从 wsUserConns 移除
					wsUserConnsMu.Lock()
					conns := wsUserConns[uid]
					newConns := make([]*websocket.Conn, 0, len(conns))
					for _, c := range conns {
						if c != conn {
							newConns = append(newConns, c)
						}
					}
					if len(newConns) == 0 {
						delete(wsUserConns, uid)
					} else {
						wsUserConns[uid] = newConns
					}
					wsUserConnsMu.Unlock()
				}
			}

		case ev := <-listingBroadcast:
			// 广播新挂牌事件，触发其他用户发盘列表实时刷新
			msg, _ := json.Marshal(wsBroadcastMsg{Type: "new_listing", Payload: ev})
			broadcastAll(connUser, msg)

		case ev := <-marketBroadcast:
			msg, _ := json.Marshal(wsBroadcastMsg{Type: "market_status", Payload: ev})
			broadcastAll(connUser, msg)

		case ev := <-contractBroadcast:
			msg, _ := json.Marshal(wsBroadcastMsg{Type: "contracts_changed", Payload: ev})
			broadcastAll(connUser, msg)

		case <-ticker.C:
			// 定期 ping 所有连接，清理死连接
			for conn := range connUser {
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					conn.Close()
					uid := connUser[conn]
					delete(connUser, conn)
					wsUserConnsMu.Lock()
					conns := wsUserConns[uid]
					newConns := make([]*websocket.Conn, 0, len(conns))
					for _, c := range conns {
						if c != conn {
							newConns = append(newConns, c)
						}
					}
					if len(newConns) == 0 {
						delete(wsUserConns, uid)
					} else {
						wsUserConns[uid] = newConns
					}
					wsUserConnsMu.Unlock()
				}
			}
		}
	}
}
