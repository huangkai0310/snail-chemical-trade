module github.com/huangkai0310/snail-chemical-trade/api-gateway

go 1.22

require (
	github.com/gin-gonic/gin v1.10.0
	github.com/golang-jwt/jwt/v5 v5.2.1
	github.com/google/uuid v1.6.0
	github.com/gorilla/websocket v1.5.3
	github.com/jackc/pgx/v5 v5.7.1
	github.com/rs/zerolog v1.33.0
	golang.org/x/crypto v0.27.0
	github.com/huangkai0310/snail-chemical-trade/matching-engine v0.0.0
)

replace github.com/huangkai0310/snail-chemical-trade/matching-engine => ../matching-engine
