#!/bin/bash
# ==========================================
# ChemBridge 本地开发一键启动脚本
# 用法: bash scripts/dev.sh [module]
#   all     - 启动全部模块（默认）
#   infra   - 仅启动 PostgreSQL + Redis
#   backend - 启动 API 网关 + 撮合引擎
#   web     - 启动前端开发服务器
# ==========================================

set -e

ROOT=$(dirname "$0")/..
cd "$ROOT"

start_infra() {
    echo ">>> 启动基础设施 (PostgreSQL + Redis + MinIO)..."
    cd deploy
    docker-compose up -d
    cd ..
    echo ">>> 基础设施已启动"
}

start_backend() {
    echo ">>> 启动 API 网关..."
    cd backend/api-gateway
    go run . &
    echo ">>> API 网关: http://localhost:8080"
    echo ">>> WebSocket: ws://localhost:8080/ws"
    cd ../..
}

start_web() {
    echo ">>> 启动前端开发服务器..."
    cd web
    npm run dev &
    cd ..
}

case "${1:-all}" in
    infra)
        start_infra
        ;;
    backend)
        start_backend
        ;;
    web)
        start_web
        ;;
    all)
        start_infra
        sleep 3
        start_backend
        start_web
        wait
        ;;
    *)
        echo "用法: $0 {all|infra|backend|web}"
        exit 1
        ;;
esac
