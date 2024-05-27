import { JUPITER_PRICE_API } from "./config";

export interface JupiterPriceResponse {
  data: {
    [symbol: string]: JupiterPrice;
  };
  timeTaken: number;
}

export interface JupiterPrice {
  id: string;
  mintSymbol: string;
  vsToken: string;
  vsTokenSymbol: string;
  price: number;
}

export async function getPrices(tokens: string[]): Promise<JupiterPrice[]> {
  const response = await fetch(JUPITER_PRICE_API + tokens.join(","));
  const responseJson = (await response.json()) as JupiterPriceResponse;
  return tokens.map((token) => responseJson.data[token]);
}
