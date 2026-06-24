import type { Product, Listing } from "./types";

export const products: Product[] = [
  { id: "methanol", name: "甲醇", symbol: "MA" },
  { id: "pta", name: "PTA", symbol: "TA" },
  { id: "styrene", name: "苯乙烯", symbol: "SM" },
  { id: "meg", name: "乙二醇", symbol: "EG" },
  { id: "pp", name: "聚丙烯", symbol: "PP" },
  { id: "benzene", name: "纯苯", symbol: "BZ" },
];

export const fakeListings: Listing[] = [
  // 买盘 — 甲醇
  {
    id: "b001", productId: "methanol", productName: "甲醇", side: "buy",
    price: 2420, quantity: 500, unit: "吨", deliveryPeriod: "7月下",
    deliveryLocation: "江苏张家港", specs: "99.9% 工业级",
    companyName: "常州恒泰化工", createdAt: "2026-06-24T09:15:00Z",
  },
  {
    id: "b002", productId: "methanol", productName: "甲醇", side: "buy",
    price: 2410, quantity: 1000, unit: "吨", deliveryPeriod: "7月下",
    deliveryLocation: "江苏太仓", specs: "99.9% 工业级",
    companyName: "浙江中化物资", createdAt: "2026-06-24T09:30:00Z",
  },
  {
    id: "b003", productId: "methanol", productName: "甲醇", side: "buy",
    price: 2400, quantity: 2000, unit: "吨", deliveryPeriod: "8月上",
    deliveryLocation: "江苏南通", specs: "99.85% 工业级",
    companyName: "上海润达新材料", createdAt: "2026-06-24T08:50:00Z",
  },
  // 卖盘 — 甲醇
  {
    id: "s001", productId: "methanol", productName: "甲醇", side: "sell",
    price: 2450, quantity: 800, unit: "吨", deliveryPeriod: "7月下",
    deliveryLocation: "江苏张家港", specs: "99.9% 优级品",
    companyName: "山西晋煤化工", createdAt: "2026-06-24T09:00:00Z",
  },
  {
    id: "s002", productId: "methanol", productName: "甲醇", side: "sell",
    price: 2460, quantity: 1500, unit: "吨", deliveryPeriod: "7月下",
    deliveryLocation: "江苏江阴", specs: "99.9% 工业级",
    companyName: "内蒙古博源化工", createdAt: "2026-06-24T09:20:00Z",
  },
  {
    id: "s003", productId: "methanol", productName: "甲醇", side: "sell",
    price: 2475, quantity: 500, unit: "吨", deliveryPeriod: "8月上",
    deliveryLocation: "江苏镇江", specs: "99.9% 优级品",
    companyName: "河南能源化工", createdAt: "2026-06-24T08:30:00Z",
  },
  // PTA
  {
    id: "b004", productId: "pta", productName: "PTA", side: "buy",
    price: 5950, quantity: 1000, unit: "吨", deliveryPeriod: "7月下",
    deliveryLocation: "浙江萧山", specs: "优等品",
    companyName: "绍兴永盛化纤", createdAt: "2026-06-24T08:00:00Z",
  },
  {
    id: "b005", productId: "pta", productName: "PTA", side: "buy",
    price: 5930, quantity: 500, unit: "吨", deliveryPeriod: "8月上",
    deliveryLocation: "浙江绍兴", specs: "优等品",
    companyName: "桐乡新凤鸣", createdAt: "2026-06-24T09:45:00Z",
  },
  {
    id: "s004", productId: "pta", productName: "PTA", side: "sell",
    price: 5980, quantity: 2000, unit: "吨", deliveryPeriod: "7月下",
    deliveryLocation: "浙江宁波", specs: "优等品",
    companyName: "恒力石化", createdAt: "2026-06-24T09:10:00Z",
  },
  {
    id: "s005", productId: "pta", productName: "PTA", side: "sell",
    price: 6000, quantity: 1000, unit: "吨", deliveryPeriod: "8月上",
    deliveryLocation: "浙江嘉兴", specs: "一等品",
    companyName: "逸盛石化", createdAt: "2026-06-24T08:20:00Z",
  },
  // 苯乙烯
  {
    id: "b006", productId: "styrene", productName: "苯乙烯", side: "buy",
    price: 9350, quantity: 300, unit: "吨", deliveryPeriod: "7月下",
    deliveryLocation: "江苏常州", specs: "99.8% 聚合级",
    companyName: "常州新阳科技", createdAt: "2026-06-23T16:00:00Z",
  },
  {
    id: "s006", productId: "styrene", productName: "苯乙烯", side: "sell",
    price: 9400, quantity: 500, unit: "吨", deliveryPeriod: "7月下",
    deliveryLocation: "江苏南京", specs: "99.8% 聚合级",
    companyName: "扬子石化", createdAt: "2026-06-24T07:30:00Z",
  },
];
