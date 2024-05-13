import { getMeteoraPairs, type MeteoraDlmmPair } from "./meteora";
import {
  getDexScreenerPairs,
  type DexScreenerActivityInfo,
  type DexScreenerLiquidity,
  type DexScreenerPair,
  type DexScreenerToken,
} from "./dex-screener";

export interface DexScreenerPairEnriched extends DexScreenerPair {
  liquidity: DexScreenerLiquidityEnriched;
  bin_step: number;
  base_fee: number;
  volume24h: DexScreenerActivityInfoEnriched;
  fees24h: DexScreenerActivityInfoEnriched;
  feeToTvl: DexScreenerActivityInfoEnriched;
  trend: "Up" | "Down";
}

export interface DexScreenerLiquidityEnriched extends DexScreenerLiquidity {
  meteora: number;
}

export interface DexScreenerActivityInfoEnriched
  extends DexScreenerActivityInfo {
  min: number;
}

export interface OpportunityData {
  pairAddress: string;
  pairName: string;
  base: DexScreenerToken;
  quote: DexScreenerToken;
  binStep: number;
  baseFee: number;
  liquidity: number;
  fdv: number;
  volume24h: DexScreenerActivityInfoEnriched;
  trend: "Up" | "Down";
  fees24h: DexScreenerActivityInfoEnriched;
  feeToTvl: DexScreenerActivityInfoEnriched;
}

function addMeteoraData(
  dexScreenerData: DexScreenerPair[],
  meteoraData: MeteoraDlmmPair[]
): DexScreenerPairEnriched[] {
  // Copy the DEX Screener data, but use the enriched type
  const enrichedData: DexScreenerPairEnriched[] = JSON.parse(
    JSON.stringify(dexScreenerData)
  );

  // Loop through each pair and enrich the data w/ the Meteora data
  enrichedData.forEach((dexScreenerPair) => {
    // Get the Neteora pair matching the DEX screener pair
    let meteoraPair = meteoraData.find(
      (m) => m.address == dexScreenerPair.pairAddress
    );
    if (
      // Make sure we have a Meteora pair
      meteoraPair &&
      // Make sure we have liquidity
      Number(meteoraPair.liquidity) > 0
    ) {
      // Get the liquidity
      if (!dexScreenerPair.liquidity) {
        dexScreenerPair.liquidity = {
          usd: 0,
          base: 0,
          quote: 0,
          meteora: Number(meteoraPair.liquidity),
        };
      } else {
        dexScreenerPair.liquidity.meteora = Number(meteoraPair.liquidity);
      }

      // Get the bin step and base fee
      dexScreenerPair.bin_step = meteoraPair.bin_step;
      dexScreenerPair.base_fee = Number(meteoraPair.base_fee_percentage) / 100;

      // Get projected 24H volume
      dexScreenerPair.volume24h = {
        h24: dexScreenerPair.volume.h24,
        h6: dexScreenerPair.volume.h6 * 4,
        h1: dexScreenerPair.volume.h1 * 24,
        m5: dexScreenerPair.volume.m5 * 288,
        min: 0,
      };
      dexScreenerPair.volume24h.min = Math.min(
        dexScreenerPair.volume24h.h24,
        dexScreenerPair.volume24h.h6,
        dexScreenerPair.volume24h.h1,
        dexScreenerPair.volume24h.m5
      );

      // Estimate fees
      dexScreenerPair.fees24h = {
        h24: dexScreenerPair.base_fee * dexScreenerPair.volume24h.h24,
        h6: dexScreenerPair.base_fee * dexScreenerPair.volume24h.h6,
        h1: dexScreenerPair.base_fee * dexScreenerPair.volume24h.h1,
        m5: dexScreenerPair.base_fee * dexScreenerPair.volume24h.m5,
        min: dexScreenerPair.base_fee * dexScreenerPair.volume24h.min,
      };

      // Calculate 24H fee / TVL
      dexScreenerPair.feeToTvl = {
        h24: dexScreenerPair.fees24h.h24 / dexScreenerPair.liquidity.meteora,
        h6: dexScreenerPair.fees24h.h6 / dexScreenerPair.liquidity.meteora,
        h1: dexScreenerPair.fees24h.h1 / dexScreenerPair.liquidity.meteora,
        m5: dexScreenerPair.fees24h.m5 / dexScreenerPair.liquidity.meteora,
        min: dexScreenerPair.fees24h.min / dexScreenerPair.liquidity.meteora,
      };

      // Determine the fee trend
      const trendNumbers: number[] = [];
      trendNumbers.push(
        dexScreenerPair.volume24h.m5 >= dexScreenerPair.volume24h.h1 ? 1 : -1
      );
      trendNumbers.push(
        dexScreenerPair.volume24h.h1 >= dexScreenerPair.volume24h.h6 ? 1 : -1
      );
      trendNumbers.push(
        dexScreenerPair.volume24h.h6 >= dexScreenerPair.volume24h.h24 ? 1 : -1
      );
      const trendTotal = trendNumbers.reduce(
        (total, current) => total + current
      );
      dexScreenerPair.trend = trendTotal > 0 ? "Up" : "Down";
    }
  });
  return enrichedData;
}

export async function getOpportunities(): Promise<OpportunityData[]> {
  // Fetch the Meteora data
  const meteoraPairs = await getMeteoraPairs();

  // Create an array of addresses to pass to the DEX Screener API
  const addresses = meteoraPairs.map((pair) => pair.address);

  // Fetch the data from the DEX Screener API
  let dexScreenerPairs = await getDexScreenerPairs(addresses);

  // Enrich the DEX Screener data with Meteora data
  const enrichedDexScreenerPairs = addMeteoraData(
    dexScreenerPairs,
    meteoraPairs
  )
    // Filter to remove markets we don't want
    .filter(
      (market) =>
        // Needs to have more than 1k liquidity
        market.liquidity.meteora > 1000
    )
    // Sort by the highest 24H Fee / TVL
    .sort((a, b) => b.feeToTvl.min - a.feeToTvl.min);

  return enrichedDexScreenerPairs.map((pair) => {
    return {
      pairAddress: pair.pairAddress,
      pairName: pair.baseToken.symbol + "-" + pair.quoteToken.symbol,
      base: pair.baseToken,
      quote: pair.quoteToken,
      binStep: pair.bin_step,
      baseFee: pair.base_fee,
      liquidity: pair.liquidity.meteora,
      fdv: pair.fdv,
      volume24h: pair.volume24h,
      trend: pair.trend,
      fees24h: pair.fees24h,
      feeToTvl: pair.feeToTvl,
    };
  });
}
