/** 挂牌/换盘状态展示文案 */

export function formatListingStatus(status: string, filled = 0): string {
  switch (status) {
    case "OPEN":
      return "挂盘中";
    case "PARTIAL":
      return "挂盘中（部分成交）";
    case "FILLED":
      return "已成交";
    case "CANCELLED":
      return "已撤盘";
    case "EXPIRED":
      return filled > 0 ? "已过期（部分成交）" : "已过期";
    case "SCHEDULED":
      return "待发布";
    default:
      return status;
  }
}

export function formatSwapBoardStatus(
  status: string,
  opts?: {
    sellFilled?: number;
    buyFilled?: number;
    negotiating?: boolean;
    anySingleSideLock?: boolean;
  },
): string {
  if (opts?.negotiating) return "商谈中";
  switch (status) {
    case "MATCHED":
      return "已成交";
    case "CANCELLED":
      return "已撤盘";
    case "EXPIRED": {
      const partial = (opts?.sellFilled ?? 0) > 0 || (opts?.buyFilled ?? 0) > 0;
      return partial ? "已过期（部分成交）" : "已过期";
    }
    case "SCHEDULED":
      return "待发布";
    default:
      if (opts?.anySingleSideLock) return "部分单边锁定";
      return "挂盘中";
  }
}
