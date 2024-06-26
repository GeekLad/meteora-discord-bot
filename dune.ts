import { DuneClient } from "@duneanalytics/client-sdk";
import { DUNE_QUERY_ID } from "./config";

export interface AllSolanaOpportunites {
  updated: number;
  symbol: string;
  address: string;
  volume: number;
  price_variation_ratio: number;
  volumeToTvl: number;
}

export async function refreshAllSolanaOpportunities(client: DuneClient) {
  return client.exec.executeQuery(DUNE_QUERY_ID);
}

export async function getAllSolanaOpportunities(
  client: DuneClient
): Promise<AllSolanaOpportunites[] | undefined> {
  const result = await client.getLatestResult({
    queryId: DUNE_QUERY_ID,
    opts: { maxAgeHours: 24 * 7 },
  });
  if (result.result) {
    return result.result.rows.map((opty) => {
      return {
        updated:
          new Date(String(result.execution_ended_at)).getTime() -
          Number(opty.minutes_delayed) * 60 * 1000,
        symbol: String(opty.token),
        address: String(opty.token_address),
        price_variation_ratio:
          Math.round(Number(opty.price_variation_ratio) * 10000) / 10000,
        volume: Math.round(Number(opty.estimated_usd_volume)),
        volumeToTvl: Math.round(Number(opty.volume_to_tvl) * 100) / 100,
      };
    });
  }
  return undefined;
}
