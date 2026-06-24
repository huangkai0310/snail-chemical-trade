module github.com/snailchemical/chem-bridge/api-gateway

go 1.22

require (
    github.com/gin-gonic/gin v1.10.0
    github.com/gorilla/websocket v1.5.3
    github.com/rs/zerolog v1.33.0
    github.com/snailchemical/chem-bridge/matching-engine v0.0.0
)

replace github.com/snailchemical/chem-bridge/matching-engine => ../matching-engine
