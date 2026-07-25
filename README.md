# 禾合 (ChemBridge) — 化工量化交易平台

化工产品的数字化交易市场：海量数据采集 → 量化分析 → 策略指导 → 撮合交易。

## 项目结构

```
chem-bridge/
├── backend/
│   ├── matching-engine/   # Go 撮合引擎（内存订单簿 + 价格优先/时间优先）
│   ├── api-gateway/       # Go API 网关（RESTful + WebSocket 实时推送）
│   └── proto/             # protobuf 定义（gRPC 服务间通信）
├── data/
│   ├── crawler/           # Python 数据采集（期货行情 / 现货报价 / 产业链数据）
│   └── quant/             # Python 量化分析（多因子模型 / ML 预测 / 回测引擎）
├── web/                   # Next.js 前端（交易看板 / 挂牌系统 / 数据可视化）
├── deploy/                # Docker Compose 部署配置
├── docs/                  # 架构文档
└── scripts/               # 开发脚本
```

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 撮合引擎 | Go | 内存订单簿，毫秒级延迟 |
| API 网关 | Go (Gin) | RESTful + WebSocket |
| 数据采集 | Python (Scrapy) | 多源爬取管线 |
| 量化分析 | Python (Pandas/NumPy) | 多因子模型 + ML |
| 前端 | Next.js / TypeScript | TradingView + ECharts |
| 数据库 | PostgreSQL + Redis | MVP 阶段 |
| 时序存储 | ClickHouse | 成长期引入 |

## 快速开始

### 前置条件

- Go 1.22+
- Python 3.12+
- Node.js 22+
- Docker & Docker Compose

### 本地开发

```bash
# 1. 启动基础设施
cd deploy
docker-compose up -d

# 2. 启动 API 网关 + 撮合引擎
cd backend/api-gateway
go run .

# 3. 数据采集 + 量化分析（按需）
cd data/crawler && pip install -e .
crawler collect -s sample -p benzene -i 1d -n 90   # 离线样例
# crawler collect -s platform -p benzene -i 1d -n 120  # 生产 API

cd ../quant && pip install -e .
quant analyze -p benzene -i 1d
quant forecast -p benzene -i 1d --horizon 5

# 4. 启动前端
cd web
npm install
npm run dev
```

数据落盘见 `data/warehouse/`；模块说明见 `data/crawler/README.md`、`data/quant/README.md`。

## 域名规划

| 域名 | 用途 | Cloudflare |
|------|------|-----------|
| trade.snailchemical.com | 交易平台主页 | Proxied |
| api.snailchemical.com | API 接口 | DNS only |
| data.snailchemical.com | 数据看板 | Proxied |

## 合规提示

本项目定位为「现货电子交易市场」而非「期货交易场所」。每一笔交易必须完成实物交割，不设标准化合约、不对冲平仓、不净额结算。

---

*禾合 — 让化工交易发生*
