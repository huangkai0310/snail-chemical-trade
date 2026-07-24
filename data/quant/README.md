# 量化分析 (quant)

读取 `data/warehouse` 中的 OHLCV，计算技术指标、波动率摘要与简单预测。

## 安装

```bash
cd data/quant
pip install -e .
```

## 用法

先采集数据（示例）：

```bash
cd ../crawler && pip install -e . && crawler collect -s sample -p benzene -i 1d -n 90
```

然后分析：

```bash
quant analyze -p benzene -i 1d
quant indicators -p benzene -i 1d
quant forecast -p benzene -i 1d --horizon 5
```

报告默认写入 `data/warehouse/reports/`。

## 模块

| 模块 | 能力 |
|------|------|
| `indicators` | MA / EMA / MACD / RSI / 布林带 / 已实现波动率 / ATR |
| `analysis` | 价格区间、收益统计、波动率、动量信号摘要 |
| `forecast` | EWMA 对数收益外推（研究用，非投资建议） |
| `backtest` | 策略模板回测（双均线 / RSI / MACD / 买入持有） |

```bash
quant backtest -p benzene -i 1d --strategy dual_ma --fast 5 --slow 20
```

后续可接多因子选品、价格预测 ML、参数优化；本阶段先打通「采集 → 仓库 → 分析 → 回测」链路。

## 前端

Web 端 `/quant` 页面复用平台 `price-history` API，在浏览器内计算同口径指标与 EWMA 预测（见 `web/src/lib/quant-indicators.ts`）。
