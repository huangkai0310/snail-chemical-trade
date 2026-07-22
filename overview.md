# 议价管理页增强：发盘序号 + 利弊徽章升级

## 改动概要

用户需求：议价管理列表每条加上**发盘的序号**，并**醒目体现收到的议价对己方的利弊**。

## 具体改动

### 1. 后端 — 返回发盘序号
- **文件**：`backend/api-gateway/repo/counter_offer.go`
- `CounterOffer` struct 新增字段：
  - `RefSerialNo *int64` — 关联挂牌的发盘序号（json: `ref_serial_no`）
- 三个查询方法（`ListReceived` / `ListSent` / `ListByRef`）的 LEFT JOIN listings 多取一列：
  ```sql
  l.serial_no AS ref_serial_no
  ```
- 三处 `rows.Scan()` 同步增加 `&co.RefSerialNo`

### 2. 前端类型
- **文件**：`web/src/lib/types.ts`
- `CounterOffer` 接口新增：
  ```ts
  ref_serial_no?: number | null;     // 关联挂牌的发盘序号
  ```

### 3. 前端页面展示
- **文件**：`web/src/app/counter-offers/page.tsx`
- **发盘序号**：类型列新增一行「发盘 #序号」（如「发盘 #123」），仅 listing 类有值
- **利弊徽章升级**：议价列的价格下方，差额 + 利弊从原来的小字升级为**带背景色的 pill 徽章**：
  - 🟢 绿底：`+X.XX/吨 对己方有利`
  - 🔴 红底：`-X.XX/吨 对己方不利`
  - ⚪ 灰底：`0.00/吨 持平`
  - 判定逻辑（按当前 tab 区分收到/发出）：收到的买盘对方出价越高越有利、卖盘对方要价越低越有利；发出反向

## 部署状态
| 项目 | 状态 |
|------|------|
| 后端编译 | ✅ exit 0 |
| 后端部署 | ✅ active, health ok |
| 前端构建 | ✅ 9/9 静态页通过 |
| 前端部署 | ✅ trade.snailchemical.com = 200 |
| /counter-offers | ✅ 200 |
