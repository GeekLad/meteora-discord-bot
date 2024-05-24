import { METEORA_API_URL } from "./config";
import type { UnifiedFetcher } from "./util";

export interface MeteoraDlmmPair {
  address: string;
  name: string;
  mint_x: string;
  mint_y: string;
  reserve_x: string;
  reserve_y: string;
  reserve_x_amount: number;
  reserve_y_amount: number;
  bin_step: number;
  base_fee_percentage: string;
  max_fee_percentage: string;
  protocol_fee_percentage: string;
  liquidity: string;
  reward_mint_x: string;
  reward_mint_y: string;
  fees_24h: number;
  today_fees: number;
  trade_volume_24h: number;
  cumulative_trade_volume: string;
  cumulative_fee_volume: string;
  current_price: number;
  apr: number;
  apy: number;
  farm_apr: number;
  farm_apy: number;
  hide: boolean;
}

export async function getMeteoraPairs(
  fetcher: UnifiedFetcher = fetch
): Promise<MeteoraDlmmPair[]> {
  // Fetch all pairs from the Meteora API
  const response = await fetcher(METEORA_API_URL);
  const responseText = await response.text();
  const pairs: MeteoraDlmmPair[] = JSON.parse(responseText);
  return pairs;
}
