// 后端 API 响应类型（snake_case，匹配 Go JSON tags）

export interface Product {
  id: string;
  name: string;
  name_en?: string | null;
  unit: string;
  category?: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
}

export interface Listing {
  id: string;
  serial_no: number;       // 唯一自增序号
  user_id: string;
  product_id: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  filled: number;
  status: "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED" | "EXPIRED" | "SCHEDULED";
  allow_partial?: boolean;
  allow_counter_offer?: boolean; // 是否允许议价（默认 true = 可议价）
  negotiable_terms?: string[];   // 可议条款范围（价格/数量/交割期/地/付款/交割方式/免仓/规格），空=不可议
  min_quantity?: number;     // 最小成交量（可拆单时生效，0 或 undefined 表示无限制）
  delivery_period?: string | null;
  delivery_location?: string | null;
  payment_method?: string | null; // 付款方式：款到发货/货到付款/预收保证金(10%)/见票付款/账期结算
  delivery_method?: string | null;      // 交割方式：混罐货转/货转/自提/送到，支持自定义
  free_storage_enabled?: boolean;        // 是否可免仓（默认 true）
  free_storage_days?: number | null;     // 免仓天数（可免仓时生效）
  specs?: string | Record<string, unknown> | null;
  remark?: string | null;
  expires_at?: string | null; // 过期时间 ISO
  starts_at?: string | null;  // 计划开始时间；空=已/立即发布
  created_at: string;
  updated_at: string;
  is_blocked?: boolean;  // 当前用户是否拉黑了该挂牌方（后端返回）
}

/** 可议条款定义（与后端 negotiable_terms 键一致）
 * 数量 / 交割地 / 规格不可商谈，沿用原盘。
 */
export const NEGOTIABLE_TERMS: { key: string; label: string }[] = [
  { key: "price", label: "价格" },
  { key: "delivery_period", label: "交割期" },
  { key: "payment_method", label: "付款方式" },
  { key: "delivery_method", label: "交割方式" },
  { key: "free_storage", label: "免仓期" },
];

/** 已停用的可商谈条款（历史数据可能仍含，展示与校验时过滤） */
export const RETIRED_NEGOTIABLE_TERMS = new Set([
  "quantity",
  "delivery_location",
  "specs",
]);

/** 过滤掉已停用的条款键 */
export function sanitizeNegotiableTerms(terms?: string[] | null): string[] {
  if (!terms || terms.length === 0) return [];
  return terms.filter((t) => !RETIRED_NEGOTIABLE_TERMS.has(t));
}

/** 默认全选的可议条款 */
export const DEFAULT_NEGOTIABLE_TERMS: string[] = NEGOTIABLE_TERMS.map((t) => t.key);

export interface User {
  id: string;
  username: string;
  email?: string | null;
  phone?: string | null;
  company_name?: string | null;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ListingListResponse {
  data: Listing[];
}

export interface Trade {
  id: string;
  product_id?: string;
  price: number;
  quantity: number;
  amount: number;
  traded_at?: string;
  buy_order_id?: string;
  sell_order_id?: string;
}

/** WebSocket 推送的成交消息（引擎格式） */
export interface WSTrade {
  id: string;
  buy_order_id: string;
  sell_order_id: string;
  product_id: string;
  price: number;
  quantity: number;
  timestamp: string;
  source?: string; // 成交来源：auto/take/counter_offer/swap/swap_private
  buy_user_id?: string;
  sell_user_id?: string;
  /** 主动方（摘盘/接受议价等）；被动方才收「发盘被接」通知 */
  aggressor_user_id?: string;
  /** 本笔若涉及普通挂牌，则为挂牌方用户 ID（用于第一人称：发盘方看「发盘被接了」） */
  listing_user_id?: string;
}

export interface TradeListResponse {
  data: TradeRecord[];
}

export interface TradeRecord {
  id: string;
  /** 成交单号（数字流水）；展示为 T + 日期 + 流水，如 T260718-42 */
  serial_no?: number;
  product_id: string;
  buy_order_id: string;
  sell_order_id: string;
  buy_user_id: string;
  sell_user_id: string;
  price: number;
  quantity: number;
  amount: number;
  delivery_period?: string | null;
  delivery_location?: string | null;
  // 双边发盘条款明细（按买卖方分别记录）
  buy_serial_no?: number | null;
  sell_serial_no?: number | null;
  buy_payment_method?: string | null;
  sell_payment_method?: string | null;
  delivery_method?: string | null;
  free_storage_enabled?: boolean | null;
  free_storage_days?: number | null;
  buy_specs?: string | Record<string, unknown> | null;
  sell_specs?: string | Record<string, unknown> | null;
  // 成交来源：auto=自动撮合, take=主动摘盘, counter_offer=议价成交, swap=换盘成交
  source?: string | null;
  aggressor_user_id?: string | null;
  traded_at: string;
  /** 我的成交：买卖双方身份（用于展示对手方 / 详情） */
  buy_company_name?: string | null;
  sell_company_name?: string | null;
  buy_username?: string | null;
  sell_username?: string | null;
}

export interface CreateListingResponse {
  listing: Listing;
  trades: Trade[];
}

export interface TakeListingResponse {
  listing: Listing;
  trades: Trade[];
}

// ---------- 数据源 ----------

/** 数据源类型：exchange=实时交易行情, warehouse=PostgreSQL持久化历史 */
export type DataSource = "exchange" | "warehouse";

export interface DataSourceOption {
  key: DataSource;
  label: string;
  description: string;
}

export const DATA_SOURCES: DataSourceOption[] = [
  { key: "exchange", label: "实时行情", description: "从交易平台实时成交数据生成K线" },
  { key: "warehouse", label: "历史仓库", description: "从PostgreSQL指标缓存读取持久化历史数据" },
];

// ---------- 价格走势 ----------

export interface PriceCandle {
  time: string;   // ISO 时间字符串
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number; // 成交额
}

export interface PriceHistoryResponse {
  data: PriceCandle[];
}

export interface LatestPriceResponse {
  product_id: string;
  latest: number;
  /** 昨结：上一工作日（国务院节假日/调休日历）行情成交量加权均价 */
  prev_settle?: number;
  /** @deprecated 同 prev_settle */
  prev_24h: number;
  change_24h: number;
  change_pct: number;
  /** 今日自然日成交量 */
  volume_today?: number;
  /** @deprecated 同 volume_today */
  volume_24h: number;
}

// ---------- 挂牌列表（含筛选分页）----------

export interface ListingPageResponse {
  data: Listing[];
  total: number;
  page: number;
  page_size: number;
  total_page: number;
}

// ---------- 订单簿深度 ----------

export interface DepthLevel {
  price: number;
  quantity: number;
  order_count: number;
  cumulative: number;
}

export interface OrderBookResponse {
  product_id: string;
  bids: unknown[];
  asks: unknown[];
  bid_depth: DepthLevel[];
  ask_depth: DepthLevel[];
}

// ---------- 资金账户 ----------

export interface Account {
  id: string;
  user_id: string;
  balance: number;    // 可用余额（元）
  frozen: number;     // 冻结金额（元）
  total_in: number;   // 累计入账
  total_out: number;  // 累计出账
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  account_id: string;
  type: "DEPOSIT" | "WITHDRAW" | "FREEZE" | "UNFREEZE" | "TRADE_DEDUCT" | "TRADE_INCOME" | "REFUND";
  amount: number;
  balance_before: number;
  balance_after: number;
  frozen_before: number;
  frozen_after: number;
  ref_id?: string | null;
  ref_type?: string | null;
  remark?: string | null;
  created_at: string;
}

export interface TransactionPageResponse {
  data: Transaction[];
  total: number;
  page: number;
  page_size: number;
  total_page: number;
}

// ---------- 换盘业务 ----------

export interface SwapListing {
  id: string;
  serial_no: number;       // 唯一自增序号
  user_id: string;
  // 我方卖出
  sell_product_id: string;
  sell_price: number;
  sell_quantity: number;
  sell_filled?: number;
  sell_delivery_period?: string | null;
  sell_delivery_location?: string | null;
  // 我方买入
  buy_product_id: string;
  buy_price: number;
  buy_quantity: number;
  buy_filled?: number;
  buy_delivery_period?: string | null;
  buy_delivery_location?: string | null;
  sell_allow_partial?: boolean; // 卖出是否允许拆单
  sell_min_quantity?: number;   // 卖出最小成交量（0 = 无限制）
  sell_payment_method?: string | null; // 卖出付款方式
  sell_delivery_method?: string | null; // 卖出交割方式（混罐货转/货转/自提/送到）
  sell_free_storage_enabled?: boolean;  // 卖出是否可免仓
  sell_free_storage_days?: number | null; // 卖出免仓天数
  sell_specs?: string | null;           // 卖出规格
  buy_allow_partial?: boolean;  // 买入是否允许拆单
  buy_min_quantity?: number;    // 买入最小成交量（0 = 无限制）
  buy_payment_method?: string | null;  // 买入付款方式
  buy_delivery_method?: string | null;  // 买入交割方式
  buy_free_storage_enabled?: boolean;    // 买入是否可免仓
  buy_free_storage_days?: number | null; // 买入免仓天数
  buy_specs?: string | null;             // 买入规格
  remark?: string | null;
  // 商谈设置 — sell/buy 各自独立
  sell_allow_counter_offer?: boolean; // 卖出是否接受商谈
  sell_negotiable_terms?: string[];   // 卖出可议条款范围
  buy_allow_counter_offer?: boolean;  // 买入是否接受商谈
  buy_negotiable_terms?: string[];    // 买入可议条款范围
  // 兼容字段（后端合并返回）
  allow_counter_offer?: boolean; // 任意一方可商谈则为 true
  negotiable_terms?: string[];   // 合并的可议条款
  // 单边交易设置
  allow_single_side?: boolean;   // 是否允许单边交易（默认 true）
  single_side_mode?: "both" | "single_buy" | "single_sell" | "none"; // 单边模式（默认 both）
  status: "OPEN" | "MATCHED" | "CANCELLED" | "EXPIRED" | "SCHEDULED";
  expires_at?: string | null;
  starts_at?: string | null;
  created_at: string;
  updated_at: string;
  is_blocked?: boolean;  // 当前用户是否拉黑了该换盘方（后端返回）
}

export interface SwapPageResponse {
  data: SwapListing[];
  total: number;
  page: number;
  page_size: number;
  total_page: number;
}

// ---------- 前台展示辅助 ----------

/** 产品缩写符号表 */
const PRODUCT_SYMBOLS: Record<string, string> = {
  methanol: "MA",
  pta: "TA",
  styrene: "SM",
  meg: "EG",
  pp: "PP",
  benzene: "BZ",
  propylene: "PL",
  phenol: "PH",
  acetone: "AC",
  isopropanol: "IPA",
  mibk: "MIBK",
};

export function getProductSymbol(product: Product): string {
  return PRODUCT_SYMBOLS[product.id] ?? product.name_en ?? product.id.toUpperCase();
}

export function formatSide(side: "BUY" | "SELL"): "buy" | "sell" {
  return side === "BUY" ? "buy" : "sell";
}

export function formatPrice(price: number): string {
  return `¥${price.toFixed(2)}`;
}

// ---------- 付款方式 ----------

/** 化工贸易常用付款方式（发布挂牌时手动选择，列表直接展示） */
export const PAYMENT_METHOD_OPTIONS: string[] = [
  "先款后货",
  "预付10%保证金，交货前付全款",
];

/** 现货默认付款方式 */
export const DEFAULT_PAYMENT_SPOT = "先款后货";
/** 远期纸货默认付款方式 */
export const DEFAULT_PAYMENT_FORWARD = "预付10%保证金，交货前付全款";

/** 根据交割期返回默认付款方式：现货→先款后货，远期→预付10%保证金，交货前付全款 */
export function getDefaultPayment(deliveryPeriod: string): string {
  return deliveryPeriod === "现货" ? DEFAULT_PAYMENT_SPOT : DEFAULT_PAYMENT_FORWARD;
}

// ---------- 议价业务 ----------

export interface CounterOffer {
  id: string;
  ref_type: "listing" | "swap";
  ref_id: string;
  mode?: "sell" | "buy" | "both" | null;  // 仅 swap 时有效
  negotiation_group_id?: string | null;   // 双向换盘同批商谈
  offer_user_id: string;
  listing_user_id: string;
  offer_price: number;
  offer_quantity: number;
  // 可协商的其他条款（议价方提出，接受后覆盖原盘条款）
  offer_delivery_period?: string | null;
  offer_delivery_location?: string | null;
  offer_payment_method?: string | null;
  offer_delivery_method?: string | null;
  offer_free_storage_enabled?: boolean | null;
  offer_free_storage_days?: number | null;
  offer_specs?: string | null;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "CANCELLED" | "PARTIAL_ACCEPTED";
  rejected_reason?: string | null;
  cancel_reason?: string | null;  // 自动撤销原因：对方已成交/对方已撤盘
  accepted_terms?: string[];      // 部分接受时，挂牌方勾选接受的条款键（price/quantity/delivery_period/...）
  ref_side?: "BUY" | "SELL" | null;  // 关联挂牌的买卖方向（仅 listing 类有效）
  product_id?: string | null;        // 关联品种
  ref_price?: number | null;         // 关联挂牌的原价（仅 listing 类有效）
  ref_created_at?: string | null;    // 关联挂牌的发盘日期（仅 listing 类有效）
  ref_serial_no?: number | null;     // 关联挂牌的发盘序号（仅 listing 类有效）
  ref_delivery_method?: string | null;      // 关联挂牌的交割方式
  ref_free_storage_enabled?: boolean | null; // 关联挂牌是否可免仓
  ref_free_storage_days?: number | null;     // 关联挂牌免仓天数
  ref_delivery_period?: string | null;       // 关联挂牌交割期（仅 listing 类有效）
  ref_delivery_location?: string | null;     // 关联挂牌交割地（仅 listing 类有效）
  ref_payment_method?: string | null;        // 关联挂牌付款方式（仅 listing 类有效）
  ref_specs?: string | null;                 // 关联挂牌规格（JSON 文本，仅 listing 类有效）
  ref_quantity?: number | null;              // 关联挂牌总量（仅 listing 类有效）
  ref_filled?: number | null;                // 关联挂牌已成交量（仅 listing 类有效）
  created_at: string;
  updated_at: string;
}

export interface CounterOfferPageResponse {
  data: CounterOffer[];
  total: number;
  page: number;
  page_size: number;
  total_page: number;
}

// ---------- 用户黑名单 ----------

export interface BlacklistItem {
  id: string;
  user_id: string;
  blocked_user_id: string;
  /** true=可看对方发盘但不能成交；false=隐藏对方发盘 */
  allow_view?: boolean;
  blocked_name: string;
  blocked_company: string;
  created_at: string;
}

export interface BlacklistPageResponse {
  data: BlacklistItem[];
  total: number;
}
