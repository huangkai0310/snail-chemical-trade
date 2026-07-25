# 本地数据仓库 (warehouse)

采集与量化分析的本地落盘目录（ClickHouse 上线前的过渡存储）。

## 目录约定

```
warehouse/
├── ohlcv/{source}/{product_id}/{delivery_period}/{interval}.csv
├── snapshots/{source}/latest_YYYYMMDD.jsonl
└── reports/{product_id}_{interval}_analysis.json
```

## OHLCV CSV 列

| 列 | 说明 |
|----|------|
| time | ISO8601 时间戳 |
| open / high / low / close | 价格 |
| volume | 成交量 |
| turnover | 成交额 |
| product_id | 品种 ID |
| delivery_period | 交割期（默认「现货」） |
| interval | K 线周期（如 `1d` / `1h`） |
| source | 数据源标识 |

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `CHEMBRIDGE_WAREHOUSE` | `data/warehouse`（相对仓库根） | 仓库根路径 |
| `CHEMBRIDGE_API_BASE` | `https://api.snailchemical.com` | 平台 API |
