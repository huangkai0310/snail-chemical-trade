/**
 * API 客户端
 * 自动附加 Bearer token，统一错误处理
 */
import { useAuthStore } from "./auth-store";
import { suppressOwnListingToast, suppressOwnSwapTradeToast } from "./listing-toast-suppress";
import type {
  Product,
  Listing,
  ListingListResponse,
  ListingPageResponse,
  AuthResponse,
  CreateListingResponse,
  TakeListingResponse,
  TradeListResponse,
  TradeRecord,
  User,
  PriceCandle,
  PriceHistoryResponse,
  LatestPriceResponse,
  OrderBookResponse,
  Account,
  Transaction,
  TransactionPageResponse,
  SwapListing,
  SwapPageResponse,
  CounterOffer,
  CounterOfferPageResponse,
  BlacklistItem,
  BlacklistPageResponse,
  DataSource,
} from "./types";
import { upsertSavedAccount } from "./accounts";

// ---------- 基础请求 ----------

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...options, headers });

  if (!res.ok) {
    if (res.status === 401) {
      useAuthStore.getState().logout();
    }
    const body = await res.text();
    let msg: string;
    try {
      msg = JSON.parse(body).error ?? body;
    } catch {
      msg = body || res.statusText;
    }
    // 网关/代理故障时常返回整页 HTML，避免原样展示到弹窗
    msg = sanitizeApiErrorMessage(msg, res.status);
    throw new ApiError(res.status, msg);
  }

  return res.json() as Promise<T>;
}

/** 把 nginx/HTML 502 等脏错误收成可读短文案 */
export function sanitizeApiErrorMessage(raw: string, status?: number): string {
  const text = (raw || "").trim();
  if (!text) {
    return status ? `请求失败（${status}）` : "请求失败";
  }
  const looksHtml =
    /<!DOCTYPE|<html[\s>]|<head[\s>]|<title>|<body[\s>]/i.test(text) ||
    text.includes("502 Bad Gateway") ||
    text.includes("nginx/");
  if (looksHtml) {
    if (status === 502 || /502\s*Bad\s*Gateway/i.test(text)) {
      return "服务暂时不可用（502），请稍后重试";
    }
    if (status === 504 || /504\s*Gateway/i.test(text)) {
      return "网关超时（504），请稍后重试";
    }
    if (status === 503) {
      return "服务暂时不可用（503），请稍后重试";
    }
    return status ? `请求失败（${status}）` : "请求失败，请稍后重试";
  }
  // 过长纯文本也截断
  if (text.length > 200) {
    return text.slice(0, 200) + "…";
  }
  return text;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---------- 公开接口 ----------

/** 获取产品列表 */
export function fetchProducts(): Promise<Product[]> {
  return request<Product[]>("/api/v1/products");
}

export interface ProductContract {
  id: number;
  product_id: string;
  delivery_period: string;
  created_by?: string;
  first_listing_id?: string;
  created_at: string;
}

/** 某品种已建立的交割期合约 */
export function fetchProductContracts(productId: string): Promise<ProductContract[]> {
  return request<{ data: ProductContract[] }>(
    `/api/v1/products/${encodeURIComponent(productId)}/contracts`
  ).then((r) => r.data ?? []);
}

/** 市场开闭市状态（公开） */
export function fetchMarketStatus(): Promise<{ market_open: boolean; reason?: string }> {
  return request<{ market_open: boolean; reason?: string }>("/api/v1/market-status");
}

/** 获取某产品的挂牌列表（简化版，不含分页） */
export function fetchListings(productId: string): Promise<Listing[]> {
  return request<ListingPageResponse>(
    `/api/v1/listings?product_id=${encodeURIComponent(productId)}&page=1&page_size=100`
  ).then((r) => r.data);
}

/** 获取某产品的挂牌列表（带筛选+分页） */
export function fetchListingsPaged(params: {
  productId: string;
  side?: string;
  deliveryPeriod?: string;
  status?: string;
  serialNo?: number;
  page?: number;
  pageSize?: number;
}): Promise<ListingPageResponse> {
  const sp = new URLSearchParams({
    product_id: params.productId,
    page: String(params.page ?? 1),
    page_size: String(params.pageSize ?? 20),
  });
  if (params.side) sp.set("side", params.side);
  if (params.deliveryPeriod) sp.set("delivery_period", params.deliveryPeriod);
  if (params.status) sp.set("status", params.status);
  if (params.serialNo && params.serialNo > 0) sp.set("serial_no", String(params.serialNo));
  return request<ListingPageResponse>(`/api/v1/listings?${sp}`);
}

/** 指标缓存响应 */
interface IndicatorCacheListResponse {
  data: Array<{
    id: number;
    product_id: string;
    delivery_period: string;
    interval: string;
    indicator: string;
    params: Record<string, unknown>;
    value: PriceCandle[] | Record<string, unknown>;
    computed_at: string;
    data_through: string;
  }>;
}

/**
 * 从指标缓存（PostgreSQL warehouse）获取 OHLCV K 线
 * indicator_cache 表中 indicator="ohlcv" 的 value 字段存储 PriceCandle 数组
 */
async function fetchPriceHistoryFromWarehouse(
  productId: string,
  interval: string,
  limit: number,
  deliveryPeriod: string,
): Promise<PriceCandle[]> {
  const url = `/api/v1/indicators/list?product_id=${encodeURIComponent(productId)}&delivery_period=${encodeURIComponent(deliveryPeriod)}&interval=${encodeURIComponent(interval)}&indicator=ohlcv`;
  const res = await request<IndicatorCacheListResponse>(url);
  if (!res.data || res.data.length === 0) return [];
  const raw = res.data[0].value;
  if (!Array.isArray(raw)) return [];
  // 按 time 升序，截取最近 limit 条
  const candles = raw as PriceCandle[];
  candles.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  return candles.slice(-limit);
}

/** 获取价格走势 K 线（合约 = 品种 + 交割期；默认现货） */
export function fetchPriceHistory(
  productId: string,
  interval: string = "1h",
  limit: number = 60,
  deliveryPeriod?: string,
  dataSource?: DataSource,
): Promise<PriceCandle[]> {
  const dp = deliveryPeriod?.trim() || "现货";
  // warehouse 数据源：从 PostgreSQL 指标缓存读取
  if (dataSource === "warehouse") {
    return fetchPriceHistoryFromWarehouse(productId, interval, limit, dp);
  }
  // 默认 exchange 数据源：从实时交易行情读取
  const url = `/api/v1/trades/price-history?product_id=${encodeURIComponent(productId)}&interval=${interval}&limit=${limit}&delivery_period=${encodeURIComponent(dp)}`;
  return request<PriceHistoryResponse>(url).then((r) => r.data);
}

/** 获取最新价格及 24h 涨跌（合约 = 品种 + 交割期；默认现货） */
export function fetchLatestPrice(productId: string, deliveryPeriod?: string): Promise<LatestPriceResponse> {
  const dp = deliveryPeriod?.trim() || "现货";
  const url = `/api/v1/trades/latest-price?product_id=${encodeURIComponent(productId)}&delivery_period=${encodeURIComponent(dp)}`;
  return request<LatestPriceResponse>(url);
}

/** 获取订单簿（含深度聚合；按交割期过滤；默认现货） */
export function fetchOrderBook(productId: string, deliveryPeriod?: string): Promise<OrderBookResponse> {
  const dp = deliveryPeriod?.trim() || "现货";
  const url = `/api/v1/orderbook/${encodeURIComponent(productId)}?delivery_period=${encodeURIComponent(dp)}`;
  return request<OrderBookResponse>(url);
}

// ---------- 认证接口 ----------

export interface LoginParams {
  username: string;
  password: string;
}

/** 登录 */
export async function login(params: LoginParams): Promise<AuthResponse> {
  const res = await request<AuthResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(params),
  });
  useAuthStore.getState().setAuth(res.token, res.user);
  upsertSavedAccount(res.user, res.token);
  return res;
}

/** 注册 */
export async function register(params: LoginParams): Promise<AuthResponse> {
  const res = await request<AuthResponse>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify(params),
  });
  useAuthStore.getState().setAuth(res.token, res.user);
  upsertSavedAccount(res.user, res.token);
  return res;
}

/** 获取当前用户信息 */
export function fetchMe(): Promise<User> {
  return request<User>("/api/v1/auth/me");
}

// ---------- 用户偏好（自选 / 交易大厅记忆，账号级跨端同步） ----------

export interface PostingPrefsMap {
  listing?: Record<string, Record<string, unknown>>;
  swap?: Record<string, Record<string, unknown>>;
}

export interface UserPreferences {
  user_id: string;
  favorites: string[];
  trading_view: {
    productId?: string;
    deliveryPeriod?: string;
    marketType?: string;
  };
  watchlist_tab: string;
  last_route?: string | null;
  theme?: "dark" | "light";
  /** 上一发盘偏好（按品种+交割期） */
  posting_prefs?: PostingPrefsMap;
  /** 提示铃声偏好 */
  sound_prefs?: {
    enabled?: boolean;
  };
  updated_at: string;
}

export function fetchPreferences(): Promise<{ data: UserPreferences }> {
  return request<{ data: UserPreferences }>("/api/v1/preferences");
}

export function updatePreferences(params: {
  favorites?: string[];
  trading_view?: UserPreferences["trading_view"];
  watchlist_tab?: string;
  last_route?: string;
  theme?: "dark" | "light";
  sound_prefs?: {
    enabled: boolean;
  };
  posting_pref?: {
    kind: "listing" | "swap";
    key: string;
    data: Record<string, unknown>;
  };
}): Promise<{ data: UserPreferences }> {
  return request("/api/v1/preferences", {
    method: "PUT",
    body: JSON.stringify(params),
  });
}

// ---------- 挂牌接口 ----------

export interface CreateListingParams {
  product_id: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  delivery_period?: string;
  delivery_location?: string;
  delivery_method?: string;
  payment_method?: string;
  specs?: string;
  remark?: string;
  allow_partial?: boolean;
  allow_counter_offer?: boolean;
  negotiable_terms?: string[];
  free_storage_enabled?: boolean;
  free_storage_days?: number;
  min_quantity?: number;
  expires_at?: string; // ISO8601，默认当日 18:00
  starts_at?: string;  // ISO8601；空=立即发布
}

/** 创建挂牌 */
export function createListing(
  params: CreateListingParams
): Promise<CreateListingResponse> {
  suppressOwnListingToast();
  return request<CreateListingResponse>("/api/v1/listings", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** 摘盘：与指定挂牌直接成交 */
export function takeListing(
  listingId: string,
  quantity: number
): Promise<TakeListingResponse> {
  suppressOwnListingToast();
  return request<TakeListingResponse>(`/api/v1/listings/${listingId}/take`, {
    method: "POST",
    body: JSON.stringify({ quantity }),
  });
}

/** 获取最近成交记录（按合约交割期；默认现货） */
export function fetchTrades(productId?: string, limit = 20, deliveryPeriod?: string): Promise<TradeRecord[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (productId) params.set("product_id", productId);
  params.set("delivery_period", deliveryPeriod?.trim() || "现货");
  return request<TradeListResponse>(`/api/v1/trades?${params}`).then((r) => r.data);
}

/** 获取我的挂牌 */
export function fetchMyListings(): Promise<Listing[]> {
  return request<ListingListResponse>("/api/v1/listings/mine").then((r) => (r.data ?? []).filter(Boolean));
}

/** 获取我的成交 */
export function fetchMyTrades(): Promise<TradeRecord[]> {
  return request<TradeListResponse>("/api/v1/trades/mine").then((r) => (r.data ?? []).filter(Boolean));
}

// ---------- 资金账户接口 ----------

/** 获取当前用户资金账户 */
export function fetchAccount(): Promise<Account> {
  return request<Account>("/api/v1/account");
}

/** 充值 */
export function deposit(amount: number, remark?: string): Promise<{ message: string; account: Account; transaction: Transaction }> {
  return request("/api/v1/account/deposit", {
    method: "POST",
    body: JSON.stringify({ amount, remark: remark ?? "" }),
  });
}

/** 提现 */
export function withdraw(amount: number, remark?: string): Promise<{ message: string; account: Account; transaction: Transaction }> {
  return request("/api/v1/account/withdraw", {
    method: "POST",
    body: JSON.stringify({ amount, remark: remark ?? "" }),
  });
}

/** 获取资金流水 */
export function fetchTransactions(page: number = 1, pageSize: number = 20): Promise<TransactionPageResponse> {
  return request<TransactionPageResponse>(
    `/api/v1/account/transactions?page=${page}&page_size=${pageSize}`
  );
}

// ---------- 换盘接口 ----------

export interface CreateSwapParams {
  sell_product_id: string;
  sell_price: number;
  sell_quantity: number;
  sell_delivery_period?: string;
  sell_delivery_location?: string;
  sell_payment_method?: string;
  sell_delivery_method?: string;
  sell_free_storage_enabled?: boolean;
  sell_free_storage_days?: number;
  sell_specs?: string;
  buy_product_id: string;
  buy_price: number;
  buy_quantity: number;
  buy_delivery_period?: string;
  buy_delivery_location?: string;
  buy_payment_method?: string;
  buy_delivery_method?: string;
  buy_free_storage_enabled?: boolean;
  buy_free_storage_days?: number;
  buy_specs?: string;
  remark?: string;
  sell_allow_partial?: boolean;
  sell_min_quantity?: number;
  buy_allow_partial?: boolean;
  buy_min_quantity?: number;
  // 商谈设置 — sell/buy 各自独立
  sell_allow_counter_offer?: boolean; // 卖出是否接受商谈（默认 false）
  sell_negotiable_terms?: string[];   // 卖出可议条款范围
  buy_allow_counter_offer?: boolean;  // 买入是否接受商谈（默认 false）
  buy_negotiable_terms?: string[];    // 买入可议条款范围
  // 兼容旧字段
  allow_counter_offer?: boolean;
  negotiable_terms?: string[];
  // 单边交易设置
  allow_single_side?: boolean;
  single_side_mode?: "both" | "single_buy" | "single_sell" | "none";
  /** 过期时间 ISO8601，默认当日 18:00 */
  expires_at?: string;
  /** 开始时间 ISO8601；空=立即 */
  starts_at?: string;
}

/** 发布换盘挂牌 */
export function createSwap(params: CreateSwapParams): Promise<{ swap: SwapListing }> {
  suppressOwnListingToast();
  return request("/api/v1/swaps", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** 编辑换盘挂牌参数（与 CreateSwapParams 一致） */
export interface UpdateSwapParams {
  sell_product_id: string;
  sell_price: number;
  sell_quantity: number;
  sell_delivery_period?: string;
  sell_delivery_location?: string;
  sell_payment_method?: string;
  sell_delivery_method?: string;
  sell_free_storage_enabled?: boolean;
  sell_free_storage_days?: number;
  sell_specs?: string;
  buy_product_id: string;
  buy_price: number;
  buy_quantity: number;
  buy_delivery_period?: string;
  buy_delivery_location?: string;
  buy_payment_method?: string;
  buy_delivery_method?: string;
  buy_free_storage_enabled?: boolean;
  buy_free_storage_days?: number;
  buy_specs?: string;
  remark?: string;
  sell_allow_partial?: boolean;
  sell_min_quantity?: number;
  buy_allow_partial?: boolean;
  buy_min_quantity?: number;
  // 商谈设置 — sell/buy 各自独立
  sell_allow_counter_offer?: boolean;
  sell_negotiable_terms?: string[];
  buy_allow_counter_offer?: boolean;
  buy_negotiable_terms?: string[];
  // 兼容旧字段
  allow_counter_offer?: boolean;
  negotiable_terms?: string[];
  // 单边交易设置
  allow_single_side?: boolean;
  single_side_mode?: "both" | "single_buy" | "single_sell" | "none";
  expires_at?: string;
  starts_at?: string;
}

/** 编辑换盘挂牌 */
export function updateSwap(id: string, params: UpdateSwapParams): Promise<{ swap: SwapListing }> {
  suppressOwnListingToast();
  return request(`/api/v1/swaps/${id}`, {
    method: "PUT",
    body: JSON.stringify(params),
  });
}

/** 获取换盘列表 */
export function fetchSwaps(params: {
  productId?: string;
  serialNo?: number;
  page?: number;
  pageSize?: number;
}): Promise<SwapPageResponse> {
  const sp = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.pageSize ?? 20),
  });
  if (params.productId) sp.set("product_id", params.productId);
  if (params.serialNo && params.serialNo > 0) sp.set("serial_no", String(params.serialNo));
  return request<SwapPageResponse>(`/api/v1/swaps?${sp}`);
}

/** 待拼单的单边锁定 */
export interface PendingSwapLock {
  id: string;
  match_side: "sell" | "buy";
  matched_qty: number;
  matched_at: string;
  acceptor_id: string;
  acceptor_name: string;
}

export function fetchPendingSwapLocks(
  swapId: string,
  mode: "sell" | "buy"
): Promise<PendingSwapLock[]> {
  return request<{ data: PendingSwapLock[] }>(
    `/api/v1/swaps/${swapId}/pending-locks?mode=${mode}`
  ).then((r) => r.data ?? []);
}

/** 接受换盘（支持独立拼单模式：sell/buy/both；both 模式支持 sellQty/buyQty 不一致） */
export function matchSwap(
  swapId: string,
  quantity?: number,
  mode: "sell" | "buy" | "both" = "both",
  lockMatchId?: string,
  sellQty?: number,
  buyQty?: number,
): Promise<{ message: string; match_id: string; match_side: string; sell_filled: number; buy_filled: number; is_lock?: boolean; is_flash?: boolean; market_price?: boolean; extra_lock_side?: string; extra_lock_qty?: number }> {
  suppressOwnListingToast();
  suppressOwnSwapTradeToast();
  return request(`/api/v1/swaps/${swapId}/match`, {
    method: "POST",
    body: JSON.stringify({
      quantity: quantity ?? 0,
      mode,
      lock_match_id: lockMatchId ?? "",
      sell_qty: sellQty ?? 0,
      buy_qty: buyQty ?? 0,
    }),
  });
}

/** 我的换盘单边锁定记录 */
export interface SwapMatchLock {
  id: string;
  swap_id: string;
  serial_no: number;
  match_side: "sell" | "buy";
  matched_qty: number;
  matched_at: string;
}

export function fetchMySwapLocks(): Promise<SwapMatchLock[]> {
  return request<{ data: SwapMatchLock[] }>("/api/v1/swap-matches/mine").then((r) => r.data ?? []);
}

/** 取消单边锁定 */
export function cancelSwapLock(matchId: string): Promise<{ message: string }> {
  suppressOwnListingToast();
  return request(`/api/v1/swap-matches/${matchId}/lock`, { method: "DELETE" });
}

/** 撤销换盘 */
export function cancelSwap(swapId: string): Promise<{ message: string }> {
  suppressOwnListingToast();
  return request(`/api/v1/swaps/${swapId}`, { method: "DELETE" });
}

/** 获取我的换盘 */
export function fetchMySwaps(): Promise<SwapListing[]> {
  return request<{ data: SwapListing[] }>("/api/v1/swaps/mine").then((r) => (r.data ?? []).filter(Boolean));
}

/** 获取单条挂牌详情（用独立路径避免 gin 路由冲突） */
export function fetchListingDetail(id: string): Promise<{ data: Listing }> {
  return request(`/api/v1/listing-detail/${id}`);
}

/** 获取单条换盘详情（用独立路径避免 gin 路由冲突） */
export function fetchSwapDetail(id: string): Promise<{ data: SwapListing }> {
  return request(`/api/v1/swap-detail/${id}`);
}

/** 撤销挂牌（状态变为 CANCELLED） */
export function cancelListing(listingId: string): Promise<{ message: string }> {
  suppressOwnListingToast();
  return request(`/api/v1/listings/${listingId}`, { method: "DELETE" });
}

/** 编辑挂牌可编辑字段 */
export interface UpdateListingParams {
  price: number;
  quantity: number;
  min_quantity?: number;
  delivery_period?: string;
  delivery_location?: string;
  payment_method?: string;
  delivery_method?: string;
  free_storage_enabled?: boolean;
  free_storage_days?: number;
  specs?: string;
  remark?: string;
  allow_partial?: boolean;
  allow_counter_offer?: boolean;
  negotiable_terms?: string[];
  expires_at?: string;
  starts_at?: string;
}

/** 编辑挂牌（仅自己的 OPEN/PARTIAL 挂牌可编辑） */
export function updateListing(
  id: string,
  params: UpdateListingParams
): Promise<{ data: Listing }> {
  suppressOwnListingToast();
  return request(`/api/v1/listings/${id}`, {
    method: "PATCH",
    body: JSON.stringify(params),
  });
}

// ---------- 议价接口 ----------

export interface CreateCounterOfferParams {
  ref_type: "listing" | "swap";
  ref_id: string;
  mode?: "sell" | "buy" | "both";  // 仅 swap 时有效
  negotiation_group_id?: string;
  offer_price: number;
  offer_quantity: number;
  // 可协商的其他条款（可选；不传则沿用原盘条款）
  offer_delivery_period?: string;
  offer_delivery_location?: string;
  offer_payment_method?: string;
  offer_delivery_method?: string;
  offer_free_storage_enabled?: boolean;
  offer_free_storage_days?: number | null;
  offer_specs?: string;
}

/** 发起议价（后端可能对不合理价格返回 warning 提示） */
export function createCounterOffer(
  params: CreateCounterOfferParams
): Promise<{ data: CounterOffer; warning?: string }> {
  suppressOwnListingToast();
  return request("/api/v1/counter-offers", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** 获取我收到的议价列表 */
export function fetchReceivedCounterOffers(
  page: number = 1,
  pageSize: number = 20,
  status?: string
): Promise<CounterOfferPageResponse> {
  let url = `/api/v1/counter-offers/received?page=${page}&page_size=${pageSize}`;
  if (status) url += `&status=${status}`;
  return request<CounterOfferPageResponse>(url);
}

/** 获取我发出的议价列表 */
export function fetchSentCounterOffers(
  page: number = 1,
  pageSize: number = 20,
  status?: string
): Promise<CounterOfferPageResponse> {
  let url = `/api/v1/counter-offers/sent?page=${page}&page_size=${pageSize}`;
  if (status) url += `&status=${status}`;
  return request<CounterOfferPageResponse>(url);
}

/** 获取某挂牌/换盘下的议价列表 */
export function fetchCounterOffersByRef(
  refType: "listing" | "swap",
  refId: string
): Promise<CounterOfferPageResponse> {
  return request<CounterOfferPageResponse>(
    `/api/v1/counter-offers/by-ref?ref_type=${refType}&ref_id=${refId}`
  );
}

/** 接受议价
 * 对于 listing 类议价支持条款级部分接受：传入 acceptedTerms 表示仅接受这些条款（子集）；
 * 不传或传全部已议条款 → 立即按议价成交（全接受）。
 * 对于 swap 类议价忽略 acceptedTerms（整体接受/拒绝）。
 */
export function acceptCounterOffer(
  id: string,
  acceptedTerms?: string[]
): Promise<{ message: string; trade_id?: string; match_id?: string }> {
  suppressOwnListingToast();
  const body = acceptedTerms ? JSON.stringify({ accepted_terms: acceptedTerms }) : undefined;
  return request(`/api/v1/counter-offers/${id}/accept`, {
    method: "POST",
    body,
  });
}

/** 发起方对「部分接受」的二次确认（仅 PARTIAL_ACCEPTED 状态可调用）
 * action: "accept" 接受对方的部分接受并成交；"reject" 拒绝对方的部分接受。
 */
export function respondCounterOffer(
  id: string,
  action: "accept" | "reject"
): Promise<{ message: string; trade_id?: string; match_id?: string }> {
  suppressOwnListingToast();
  return request(`/api/v1/counter-offers/${id}/respond`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

/** 拒绝议价 */
export function rejectCounterOffer(
  id: string,
  reason?: string
): Promise<{ message: string }> {
  suppressOwnListingToast();
  return request(`/api/v1/counter-offers/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ rejected_reason: reason ?? "" }),
  });
}

/** 撤销议价（议价发起方主动撤销） */
export function cancelCounterOffer(
  id: string
): Promise<{ message: string }> {
  suppressOwnListingToast();
  return request(`/api/v1/counter-offers/${id}/cancel`, {
    method: "POST",
  });
}

/** 更新商谈条款参数 */
export interface UpdateCounterOfferParams {
  offer_price: number;
  offer_quantity: number;
  offer_delivery_period?: string;
  offer_delivery_location?: string;
  offer_payment_method?: string;
  offer_delivery_method?: string;
  offer_free_storage_enabled?: boolean;
  offer_free_storage_days?: number | null;
  offer_specs?: string;
}

/** 更新 PENDING 商谈条款（仅发起方可操作，不新建商谈） */
export function updateCounterOffer(
  id: string,
  params: UpdateCounterOfferParams
): Promise<{ data: CounterOffer }> {
  suppressOwnListingToast();
  return request(`/api/v1/counter-offers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(params),
  });
}

/** 查询我发出的 PENDING 商谈（用于判断某挂牌是否已有待回复商谈） */
export function fetchSentPendingCounterOffers(): Promise<CounterOffer[]> {
  return fetchSentCounterOffers(1, 200, "PENDING").then((r) => r.data ?? []);
}

/** 查询我收到的 PENDING 商谈（别人对我挂盘发起的商谈） */
export function fetchReceivedPendingCounterOffers(): Promise<CounterOffer[]> {
  return fetchReceivedCounterOffers(1, 200, "PENDING").then((r) => r.data ?? []);
}

// ---------- 黑名单接口 ----------

/** 获取我的黑名单列表 */
export function fetchBlacklist(): Promise<BlacklistItem[]> {
  return request<BlacklistPageResponse>("/api/v1/blacklist").then((r) => r.data ?? []);
}

/** 添加用户到黑名单（支持 UUID / 公司名称 / 用户名）
 * 拉黑后双方互相看不到对方发盘，且无法成交
 */
export function addToBlacklist(identifier: string): Promise<{ message: string; data: BlacklistItem }> {
  return request("/api/v1/blacklist", {
    method: "POST",
    body: JSON.stringify({
      identifier: identifier.trim(),
    }),
  });
}

/** 从黑名单移除（按黑名单记录 ID 或被拉黑用户 ID） */
export function removeFromBlacklist(idOrBlockedUserId: string): Promise<{ message: string }> {
  return request(`/api/v1/blacklist/${idOrBlockedUserId}`, { method: "DELETE" });
}

/** 按公司名/用户名模糊搜索已注册用户（用于黑名单联想拉黑） */
export function searchUsers(q: string): Promise<User[]> {
  const sp = new URLSearchParams({ q });
  return request<{ data: User[] }>(`/api/v1/users/search?${sp}`).then((r) => r.data ?? []);
}
