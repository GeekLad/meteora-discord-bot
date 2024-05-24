import { BLUE_CHIPS } from "./config";
import type { DexScreenerToken } from "./dex-screener";
import { getJupiterTokenList as getJupiterTokenList_ } from "./jupiter-token-list";
import { getOpportunities as getOpportunities_ } from "./opportunity-finder";
import type { UnifiedResponse } from "./util";

const CHUNK_SIZE = 20;
const MS_BETWEEN_MULTIFETCHES = 1000;
const TARGET_SHEET_NAME = "Market Making Opportunities";

interface UrlFetchAppResponse {
  getContentText: () => string;
}

declare namespace UrlFetchApp {
  function fetch(url: string): UrlFetchAppResponse;
  function fetchAll(urls: string[]): UrlFetchAppResponse[];
}

declare namespace Utilities {
  function sleep(ms: number): any;
}

declare namespace SpreadsheetApp {
  function getActiveSpreadsheet(): any;
  function flush(): any;
}

function googleFetchResultToUnifiedResponse_(
  response: UrlFetchAppResponse
): UnifiedResponse {
  return {
    text: async () => response.getContentText(),
  };
}

async function googleFetch_(url: string): Promise<UnifiedResponse> {
  const response = UrlFetchApp.fetch(url);
  return googleFetchResultToUnifiedResponse_(response);
}

function chunkUrls_(urls: string[], chunkSize: number): string[][] {
  let result: string[][] = [];
  for (let i = 0; i < urls.length; i += chunkSize) {
    let chunk: string[] = urls.slice(i, i + chunkSize);
    result.push(chunk);
  }
  return result;
}

async function googleMultiFetch_(urls: string[]): Promise<UnifiedResponse[]> {
  const chunkedUrls = chunkUrls_(urls, CHUNK_SIZE);
  const responses: UnifiedResponse[] = [];
  for (let i = 0; i < chunkedUrls.length - 1; i++) {
    const responseArray = UrlFetchApp.fetchAll(chunkedUrls[i]);
    responseArray.forEach((response) => {
      responses.push(googleFetchResultToUnifiedResponse_(response));
    });
    Utilities.sleep(MS_BETWEEN_MULTIFETCHES);
  }
  return responses;
}

// Functions to add hyperlink formulas
function rugCheckHyperlink_(token: DexScreenerToken) {
  if (!BLUE_CHIPS.includes(token.symbol)) {
    return `=HYPERLINK("https://rugcheck.xyz/tokens/${token.address}", "${token.symbol} RugCheck")`;
  }
  return "";
}

function duneHyperlink_(address: string) {
  return `=HYPERLINK("https://dune.com/geeklad/meteora-dlmm-fee-to-tvl?pair_address_tb3c72=${address}", "Dune Fee / TVL")`;
}

function dexScreenerHyperlink_(address: string) {
  return `=HYPERLINK("https://dexscreener.com/solana/${address}", "DEX Screener")`;
}

function meteoraHyperlink_(address: string) {
  return `=HYPERLINK("https://app.meteora.ag/dlmm/${address}", "Meteora DLMM")`;
}

export function onOpen() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet();
  var entries = [
    {
      name: "Refresh DEX Data",
      functionName: "refreshMarketData",
    },
  ];
  sheet.addMenu("Refresh DEX Data", entries);
  // refreshMarketData();
}

export async function refreshMarketData() {
  const sheet =
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TARGET_SHEET_NAME);
  sheet.clear();
  sheet.getRange("A1").setValue("Updating data...");
  SpreadsheetApp.flush();

  const tokenMap = await getJupiterTokenList_(googleFetch_);
  const data = await getOpportunities_(
    tokenMap,
    googleFetch_,
    googleMultiFetch_
  );
  const opportunities = data
    .filter((opty) => opty.liquidity > 600)
    .map((opty) => [
      opty.pairName,
      opty.base.symbol,
      opty.quote.symbol,
      opty.strict,
      rugCheckHyperlink_(opty.base),
      rugCheckHyperlink_(opty.quote),
      duneHyperlink_(opty.pairAddress),
      dexScreenerHyperlink_(opty.pairAddress),
      meteoraHyperlink_(opty.pairAddress),
      opty.binStep,
      opty.baseFee,
      opty.liquidity,
      opty.volume24h.m5,
      opty.volume24h.h1,
      opty.volume24h.h6,
      opty.volume24h.h24,
      opty.trend,
      opty.feeToTvl.min,
      opty.feeToTvl.max,
    ]);
  opportunities.unshift([
    "Pair",
    "Base",
    "Quote",
    "Strict List",
    "Base RugCheck",
    "Quote RugCheck",
    "Dune Fee / TVL",
    "DEX Screener",
    "Meteora Market",
    "Bin Step",
    "Base Fee %",
    "Liquidity",
    "Projected 24H Volume\nBased on 5M Volume",
    "Projected 24H Volume\nBased on 1H Volume",
    "Projected 24H Volume\nBased on 6H Volume",
    "24H Volume",
    "Volume Trend",
    "Min Estimated\n24H Fees / TVL",
    "Max Estimated\n24H Fees / TVL",
  ]);
  // Update time
  sheet.getRange("A1").setValue("Last updated:");
  sheet.getRange("B1").setValue(new Date().toUTCString());

  // Define the range dynamically
  var range = sheet.getRange(
    2,
    1,
    opportunities.length,
    opportunities[0].length
  );

  // Write the data to the range starting from the last row
  range.setValues(opportunities);
}
