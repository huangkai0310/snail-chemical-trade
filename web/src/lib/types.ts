export type ListingSide = "buy" | "sell";

export interface Listing {
  id: string;
  productId: string;
  productName: string;
  side: ListingSide;
  price: number;
  quantity: number;
  unit: string;
  deliveryPeriod: string;
  deliveryLocation: string;
  specs: string;
  companyName: string;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  symbol: string;
}
