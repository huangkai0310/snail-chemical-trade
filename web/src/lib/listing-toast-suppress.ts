/** 自己主动操作（发盘/锁单/解锁/摘盘/商谈等）会收到 new_listing 回声，短时间内主页不弹「发盘有更新」 */
let suppressUntil = 0;
/** 主动参与换盘（match）后短时内不重复弹「单边成交」WS 提示（HTTP 已提示「换盘成功」） */
let suppressSwapTradeUntil = 0;

/** @param ms 抑制窗口，默认 8s（覆盖网络延迟与多次广播） */
export function suppressOwnListingToast(ms = 8000) {
  const until = Date.now() + ms;
  if (until > suppressUntil) suppressUntil = until;
}

export function shouldSuppressListingToast() {
  return Date.now() < suppressUntil;
}

export function suppressOwnSwapTradeToast(ms = 8000) {
  const until = Date.now() + ms;
  if (until > suppressSwapTradeUntil) suppressSwapTradeUntil = until;
}

export function shouldSuppressSwapTradeToast() {
  return Date.now() < suppressSwapTradeUntil;
}
