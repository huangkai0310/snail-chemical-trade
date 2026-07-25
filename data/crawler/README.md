# 数据采集 (crawler)

从平台成交、外部 CSV、样例源采集 OHLCV，写入 `data/warehouse/`。

## 安装

```bash
cd data/crawler
pip install -e .
```

## 用法

```bash
# 查看数据源
crawler list-sources

# 从生产 API 采集苯日线（默认 API: https://api.snailchemical.com）
crawler collect -s platform -p benzene -i 1d -n 120

# 采集全部活跃品种小时线
crawler collect -s platform --all -i 1h -n 168

# 离线样例（无网可跑）
crawler collect -s sample -p benzene -i 1d -n 90

# 导入外部 CSV（列名支持 日期/报价 等中文别名）
crawler collect -s csv --csv ./quotes.csv -p methanol -i 1d
```

环境变量：

| 变量 | 说明 |
|------|------|
| `CHEMBRIDGE_API_BASE` | API 根地址，默认生产 |
| `CHEMBRIDGE_WAREHOUSE` | 仓库目录，默认 `data/warehouse` |

## 数据源扩展

实现 `DataSource.collect()` 并注册到 `sources/__init__.py` 的 `SOURCES`。后续可接郑商所/卓创等；当前以平台 API + CSV 导入为主，避免未授权爬取。
