# ChemBridge 架构文档

## 1. 系统全景

```
┌─────────────────────────────────────────────────────────┐
│                     用户层                                │
│  trade.snailchemical.com        mobile                   │
│  (Next.js Web)                (Flutter)                 │
└─────────────┬───────────────────────────────────────────┘
              │ HTTPS / WSS
┌─────────────▼───────────────────────────────────────────┐
│                    Cloudflare CDN                        │
│  DNS + SSL + DDoS + Cache                               │
└─────────────┬───────────────────────────────────────────┘
              │
     ┌────────┴────────┐
     ▼                 ▼
┌─────────┐    ┌──────────────┐
│  Web App│    │  API Gateway │ (Go)
│  (SSR)  │    │  :8080       │
└─────────┘    └──────┬───────┘
                      │
        ┌─────────────┼──────────────┐
        ▼             ▼              ▼
┌───────────┐ ┌───────────┐ ┌──────────┐
│ Matching  │ │ Order     │ │ WebSocket│
│ Engine    │ │ Service   │ │ Hub      │
│ (内存撮合) │ │ (持久化)  │ │ (实时推送)│
└─────┬─────┘ └─────┬─────┘ └──────────┘
      │             │
      └──────┬──────┘
             ▼
┌──────────────────────────┐
│  Redis (缓存/消息队列)    │
└──────────────────────────┘
             │
             ▼
┌──────────────────────────┐
│  PostgreSQL (业务数据)    │
└──────────────────────────┘
```

## 2. 数据流

### 挂牌撮合流程

```
卖家挂牌         买家摘牌
    │                │
    ▼                ▼
 POST /api/v1/orders
    │                │
    ▼                ▼
[API Gateway] 校验 + 鉴权
    │
    ▼
[Matching Engine]
    ├── 价格优先匹配
    ├── 时间优先匹配
    └── 生成 Trade 记录
    │
    ├── Redis 写入 (故障恢复)
    ├── PostgreSQL 写入 (持久化)
    └── WebSocket 广播 (实时推送)
```

### 数据采集管线

**当前 MVP（已落地）**

```
[crawler CLI]
    ├── platform  → ChemBridge 公开 API（OHLCV / 最新价）
    ├── csv       → 外部报价文件导入（卓创/隆众等手工导出）
    └── sample    → 合成样例（离线调试）
           │
           ▼
[data/warehouse]  CSV / JSONL 本地仓库
           │
           ▼
[quant CLI]  指标 / 波动率分析 / EWMA 预测
```

**目标态（成长期）**

```
[Scrapy/Python]
    ├── 郑商所/大商所 行情
    ├── 卓创/隆众/百川 现货报价
    ├── 海关进出口数据
    └── 装置开工率/港口库存
           │
           ▼
[Kafka / Redis Streams]
           │
           ▼
[数据清洗 + 标准化]
           │
           ├── ClickHouse (时序存储)
           └── PostgreSQL (元数据)
```

## 3. 数据库设计（核心表）

### orders 表

```sql
CREATE TABLE orders (
    id          UUID PRIMARY KEY,
    product_id  VARCHAR(32)  NOT NULL,
    side        VARCHAR(4)   NOT NULL CHECK (side IN ('BUY', 'SELL')),
    price       DECIMAL(15,2) NOT NULL,
    quantity    DECIMAL(15,2) NOT NULL,
    filled      DECIMAL(15,2) DEFAULT 0,
    status      VARCHAR(16)  DEFAULT 'OPEN',
    user_id     UUID NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_orders_product_status ON orders(product_id, status);
```

### trades 表

```sql
CREATE TABLE trades (
    id          UUID PRIMARY KEY,
    buy_order_id  UUID REFERENCES orders(id),
    sell_order_id UUID REFERENCES orders(id),
    product_id VARCHAR(32) NOT NULL,
    price      DECIMAL(15,2) NOT NULL,
    quantity   DECIMAL(15,2) NOT NULL,
    timestamp  TIMESTAMPTZ DEFAULT NOW()
);
```

## 4. 撮合引擎设计

### 数据结构

- **OrderBook**: 每个品种一个订单簿，包含买盘（MaxHeap）和卖盘（MinHeap）
- **撮合规则**: 价格优先 + 时间优先 + 实物交割

### 延迟保证

- 撮合全程在内存完成，不阻塞等待 I/O
- Trade 写入 DB 异步化
- WebSocket 推送通过 channel 广播，不阻塞撮合路径

## 5. 合规设计要点

1. **合同非标准化**: 平台不规定统一合约规格，买卖双方自行协商品质/数量/交割日期
2. **必须实物交割**: 每笔合同到期必须有货物交付凭证，不可补差价了结
3. **挂牌/协议转让模式**: 不做集中竞价匿名撮合
4. **100% 货款**: 不做保证金/杠杆交易
5. **企业实名制**: 排除个人投资者

## 6. 部署拓扑 (MVP)

```
1 台腾讯云轻量服务器 (4C8G)
  ├── Docker Compose
  │   ├── PostgreSQL 16
  │   ├── Redis 7
  │   └── MinIO
  ├── Go 二进制 ×1 (API + 撮合)
  └── Python ×2 (爬虫 + 量化)
  
Vercel (免费)
  └── Next.js 前端

Cloudflare
  ├── DNS 解析
  ├── CDN 加速
  └── SSL 证书
```
