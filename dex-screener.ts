import { DEX_SCRENER_API_URL, MAX_URL_LENGTH } from "./config";

export interface DexScreenerApiData {
  schemaVersion: string;
  pairs: DexScreenerPair[];
  pair: null;
}

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  labels: string[];
  baseToken: DexScreenerToken;
  quoteToken: DexScreenerToken;
  priceNative: string;
  priceUsd: string;
  txns: DexScreenerTxns;
  volume: DexScreenerActivityInfo;
  priceChange: DexScreenerActivityInfo;
  liquidity: DexScreenerLiquidity;
  fdv: number;
  pairCreatedAt: number;
  info: DexScreenerPairInfo;
}

export interface DexScreenerToken {
  address: string;
  name: string;
  symbol: string;
}

export interface DexScreenerPairInfo {
  imageUrl: string;
  websites: DexScreenerWebsite[];
  socials: DexScreenerSocial[];
}

export interface DexScreenerSocial {
  type: string;
  url: string;
}

export interface DexScreenerWebsite {
  label: string;
  url: string;
}

export interface DexScreenerLiquidity {
  usd: number;
  base: number;
  quote: number;
}

export interface DexScreenerActivityInfo {
  m5: number;
  h1: number;
  h6: number;
  h24: number;
}

export interface DexScreenerTxns {
  m5: DexScreenerTxnInfo;
  h1: DexScreenerTxnInfo;
  h6: DexScreenerTxnInfo;
  h24: DexScreenerTxnInfo;
}

export interface DexScreenerTxnInfo {
  buys: number;
  sells: number;
}

function addressesToDexScreenerUrls(addresses: string[]): string[] {
  const fetchUrls = [DEX_SCRENER_API_URL];
  let addressCount = 0;
  addresses.forEach((address) => {
    const curentUrlIndex = fetchUrls.length - 1;
    addressCount++;
    const urlLength = fetchUrls[curentUrlIndex].length;
    if (fetchUrls[curentUrlIndex].length == DEX_SCRENER_API_URL.length) {
      fetchUrls[curentUrlIndex] = `${fetchUrls[curentUrlIndex]}/${address}`;
    } else {
      const updatedUrl = `${fetchUrls[curentUrlIndex]},${address}`;
      if (updatedUrl.length < MAX_URL_LENGTH && addressCount <= 30) {
        fetchUrls[curentUrlIndex] = updatedUrl;
        addressCount = 1;
      } else {
        fetchUrls.push(`${DEX_SCRENER_API_URL}/${address}`);
      }
    }
  });
  return fetchUrls;
}

export async function getDexScreenerPairs(
  addresses: string[]
): Promise<DexScreenerPair[]> {
  // Split the addresses into URLs that are less than the max # of characters
  const fetchUrls = addressesToDexScreenerUrls(addresses);

  // Fetch the data from DEX Screener
  const dexScreenerData: DexScreenerPair[] = [];
  const responses = await Promise.all(fetchUrls.map((url) => fetch(url)));
  responses.forEach(async (response, i) => {
    const responseText = await response.text();
    try {
      const data: DexScreenerApiData = JSON.parse(responseText);
      if (data.pairs) {
        data.pairs.forEach((pair) => dexScreenerData.push(pair));
      } else {
        console.warn(`Warning, error fetching: ${fetchUrls[i]}`);
      }
    } catch (err) {
      console.warn(`Warning, error fetching: ${fetchUrls[i]}`);
    }
  });
  return dexScreenerData;
}
