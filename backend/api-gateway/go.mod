module github.com/huangkai0310/snail-chemical-trade/api-gateway

go 1.22

require (
    github.com/gin-gonic/gin v1.10.0
    github.com/gorilla/websocket v1.5.3
    github.com/rs/zerolog v1.33.0
    github.com/huangkai0310/snail-chemical-trade/matching-engine v0.0.0
)

replace github.com/huangkai0310/snail-chemical-trade/matching-engine => ../matching-engine
