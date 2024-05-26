// config.ts
var METEORA_API = "https://dlmm-api.meteora.ag";
var METEORA_API_PAIR_ENDPOINT = "/pair/all";
var DEX_SCRENER_API_URL = "https://api.dexscreener.com/latest/dex/pairs/solana";
var JUPITER_TOKEN_STRICT_LIST_API = "https://token.jup.ag/strict";
var JUPITER_TOKEN_ALL_LIST_API = "https://token.jup.ag/all";
var BLUE_CHIPS = [
  "USDC",
  "SOL",
  "USDT",
  "jitoSOL",
  "bSOL",
  "JupSOL",
  "INF",
  "JLP",
  "JupSOL",
  "WBTC",
  "WETH",
  "bonkSOL",
  "LST",
  "mSOL",
  "zippySOL"
].map((token) => token.toLowerCase());

// jupiter-token-list.ts
async function getJupiterTokenList_(fetcher = fetch, listType = "strict") {
  const response = await fetcher(listType == "strict" ? JUPITER_TOKEN_STRICT_LIST_API : JUPITER_TOKEN_ALL_LIST_API);
  const data = JSON.parse(await response.text());
  const map = new Map;
  data.forEach((token) => map.set(token.address, token));
  return map;
}
var JupiterTokenListTag;
(function(JupiterTokenListTag2) {
  JupiterTokenListTag2["Community"] = "community";
  JupiterTokenListTag2["OldRegistry"] = "old-registry";
  JupiterTokenListTag2["SolanaFm"] = "solana-fm";
  JupiterTokenListTag2["Token2022"] = "token-2022";
  JupiterTokenListTag2["Unknown"] = "unknown";
  JupiterTokenListTag2["Wormhole"] = "wormhole";
})(JupiterTokenListTag || (JupiterTokenListTag = {}));

// meteora-markets.ts
async function getMeteoraPairs_(fetcher = fetch) {
  const response = await fetcher(METEORA_API + METEORA_API_PAIR_ENDPOINT);
  const responseText = await response.text();
  const pairs = JSON.parse(responseText);
  return pairs;
}

// util.ts
async function multiFetch_(urls) {
  return Promise.all(urls.map((url) => fetch(url)));
}

// dex-screener.ts
var addressesToDexScreenerUrls_ = function(addresses) {
  const fetchUrls = [DEX_SCRENER_API_URL];
  let addressCount = 0;
  addresses.forEach((address) => {
    const curentUrlIndex = fetchUrls.length - 1;
    addressCount++;
    if (fetchUrls[curentUrlIndex].length == DEX_SCRENER_API_URL.length) {
      fetchUrls[curentUrlIndex] = `${fetchUrls[curentUrlIndex]}/${address}`;
    } else {
      const updatedUrl = `${fetchUrls[curentUrlIndex]},${address}`;
      if (addressCount < 30) {
        fetchUrls[curentUrlIndex] = updatedUrl;
      } else {
        fetchUrls.push(`${DEX_SCRENER_API_URL}/${address}`);
        addressCount = 0;
      }
    }
  });
  return fetchUrls;
};
async function getDexScreenerPairs_(addresses, multiFetch_er = multiFetch_) {
  const fetchUrls = addressesToDexScreenerUrls_(addresses);
  const dexScreenerData = [];
  const responses = await multiFetch_er(fetchUrls);
  responses.forEach(async (response, i) => {
    const responseText = await response.text();
    try {
      const data = JSON.parse(responseText);
      if (data.pairs) {
        data.pairs.forEach((pair) => dexScreenerData.push(pair));
      } else {
        console.warn(`${new Date().toLocaleTimeString()}: Warning, error fetching: ${fetchUrls[i]}`);
      }
    } catch (err) {
      console.warn(`${new Date().toLocaleTimeString()}: Warning, error fetching: ${fetchUrls[i]}`);
    }
  });
  return dexScreenerData;
}

// opportunity-finder.ts
var addMeteoraData_ = function(tokenMap, dexScreenerData, meteoraData) {
  const enrichedData = dexScreenerData;
  enrichedData.forEach((dexScreenerPair) => {
    let meteoraPair = meteoraData.find((m) => m.address == dexScreenerPair.pairAddress);
    dexScreenerPair.strict = tokenMap.has(dexScreenerPair.baseToken.address) && tokenMap.has(dexScreenerPair.quoteToken.address);
    if (!dexScreenerPair.liquidity) {
      dexScreenerPair.liquidity = {
        usd: 0,
        base: 0,
        quote: 0,
        meteora: Number(meteoraPair.liquidity)
      };
    } else {
      dexScreenerPair.liquidity.meteora = Number(meteoraPair.liquidity);
    }
    dexScreenerPair.bin_step = meteoraPair.bin_step;
    dexScreenerPair.base_fee = Number(meteoraPair.base_fee_percentage) / 100;
    dexScreenerPair.volume24h = {
      h24: dexScreenerPair.volume.h24,
      h6: dexScreenerPair.volume.h6 * 4,
      h1: dexScreenerPair.volume.h1 * 24,
      m5: dexScreenerPair.volume.m5 * 288,
      min: 0,
      max: 0
    };
    dexScreenerPair.volume24h.min = Math.min(dexScreenerPair.volume24h.h24, dexScreenerPair.volume24h.h6, dexScreenerPair.volume24h.h1, dexScreenerPair.volume24h.m5);
    dexScreenerPair.volume24h.max = Math.max(dexScreenerPair.volume24h.h24, dexScreenerPair.volume24h.h6, dexScreenerPair.volume24h.h1, dexScreenerPair.volume24h.m5);
    dexScreenerPair.fees24h = {
      h24: dexScreenerPair.base_fee * dexScreenerPair.volume24h.h24,
      h6: dexScreenerPair.base_fee * dexScreenerPair.volume24h.h6,
      h1: dexScreenerPair.base_fee * dexScreenerPair.volume24h.h1,
      m5: dexScreenerPair.base_fee * dexScreenerPair.volume24h.m5,
      min: dexScreenerPair.base_fee * dexScreenerPair.volume24h.min,
      max: dexScreenerPair.base_fee * dexScreenerPair.volume24h.max
    };
    dexScreenerPair.feeToTvl = {
      h24: dexScreenerPair.fees24h.h24 / dexScreenerPair.liquidity.usd,
      h6: dexScreenerPair.fees24h.h6 / dexScreenerPair.liquidity.usd,
      h1: dexScreenerPair.fees24h.h1 / dexScreenerPair.liquidity.usd,
      m5: dexScreenerPair.fees24h.m5 / dexScreenerPair.liquidity.usd,
      min: dexScreenerPair.fees24h.min / dexScreenerPair.liquidity.usd,
      max: dexScreenerPair.fees24h.max / dexScreenerPair.liquidity.usd
    };
    const trendNumbers = [];
    trendNumbers.push(dexScreenerPair.volume24h.m5 >= dexScreenerPair.volume24h.h1 ? 1 : -1);
    trendNumbers.push(dexScreenerPair.volume24h.h1 >= dexScreenerPair.volume24h.h6 ? 1 : -1);
    trendNumbers.push(dexScreenerPair.volume24h.h6 >= dexScreenerPair.volume24h.h24 ? 1 : -1);
    const trendTotal = trendNumbers.reduce((total, current) => total + current);
    dexScreenerPair.trend = trendTotal > 0 ? "Up" : "Down";
  });
  return enrichedData;
};
async function getOpportunities_(tokenMap, fetcher = fetch, multiFetch_er = multiFetch_) {
  const meteoraPairs = await getMeteoraPairs_(fetcher);
  const addresses = meteoraPairs.map((pair) => pair.address);
  let dexScreenerPairs = await getDexScreenerPairs_(addresses, multiFetch_er);
  const enrichedDexScreenerPairs = addMeteoraData_(tokenMap, dexScreenerPairs, meteoraPairs).sort((a, b) => b.feeToTvl.min - a.feeToTvl.min);
  return enrichedDexScreenerPairs.map((pair) => {
    return {
      pairAddress: pair.pairAddress,
      pairName: pair.baseToken.symbol + "-" + pair.quoteToken.symbol,
      base: pair.baseToken,
      quote: pair.quoteToken,
      binStep: pair.bin_step,
      baseFee: pair.base_fee,
      liquidity: pair.liquidity.usd,
      fdv: pair.fdv,
      volume24h: pair.volume24h,
      trend: pair.trend,
      fees24h: pair.fees24h,
      feeToTvl: pair.feeToTvl,
      strict: pair.strict,
      bluechip: BLUE_CHIPS.includes(pair.baseToken.symbol.toLowerCase()) && BLUE_CHIPS.includes(pair.quoteToken.symbol.toLowerCase())
    };
  });
}

// google-app-script.ts
var googleFetchResultToUnifiedResponse_ = function(response) {
  return {
    text: async () => response.getContentText()
  };
};
async function googleFetch_(url) {
  const response = UrlFetchApp.fetch(url);
  return googleFetchResultToUnifiedResponse_(response);
}
var chunkUrls_ = function(urls, chunkSize) {
  let result = [];
  for (let i = 0;i < urls.length; i += chunkSize) {
    let chunk = urls.slice(i, i + chunkSize);
    result.push(chunk);
  }
  return result;
};
async function googleMultiFetch_(urls) {
  const chunkedUrls = chunkUrls_(urls, CHUNK_SIZE);
  const responses = [];
  for (let i = 0;i < chunkedUrls.length - 1; i++) {
    const responseArray = UrlFetchApp.fetchAll(chunkedUrls[i]);
    responseArray.forEach((response) => {
      responses.push(googleFetchResultToUnifiedResponse_(response));
    });
    Utilities.sleep(MS_BETWEEN_MULTIFETCHES);
  }
  return responses;
}
var rugCheckHyperlink_ = function(token) {
  if (!BLUE_CHIPS.includes(token.symbol)) {
    return `=HYPERLINK("https://rugcheck.xyz/tokens/${token.address}", "${token.symbol} RugCheck")`;
  }
  return "";
};
var duneHyperlink_ = function(address) {
  return `=HYPERLINK("https://dune.com/geeklad/meteora-dlmm-fee-to-tvl?pair_address_tb3c72=${address}", "Dune Fee / TVL")`;
};
var dexScreenerHyperlink_ = function(address) {
  return `=HYPERLINK("https://dexscreener.com/solana/${address}", "DEX Screener")`;
};
var meteoraHyperlink_ = function(address) {
  return `=HYPERLINK("https://app.meteora.ag/dlmm/${address}", "Meteora DLMM")`;
};
function onOpen() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet();
  var entries = [
    {
      name: "Refresh DEX Data",
      functionName: "refreshMarketData"
    }
  ];
  sheet.addMenu("Refresh DEX Data", entries);
}
async function refreshMarketData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TARGET_SHEET_NAME);
  sheet.clear();
  sheet.getRange("A1").setValue("Updating data...");
  SpreadsheetApp.flush();
  const tokenMap = await getJupiterTokenList_(googleFetch_);
  const data = await getOpportunities_(tokenMap, googleFetch_, googleMultiFetch_);
  const opportunities = data.filter((opty) => opty.liquidity > 600).map((opty) => [
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
    opty.feeToTvl.max
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
    "Max Estimated\n24H Fees / TVL"
  ]);
  sheet.getRange("A1").setValue("Last updated:");
  sheet.getRange("B1").setValue(new Date().toUTCString());
  var range = sheet.getRange(2, 1, opportunities.length, opportunities[0].length);
  range.setValues(opportunities);
}
var CHUNK_SIZE = 20;
var MS_BETWEEN_MULTIFETCHES = 1000;
var TARGET_SHEET_NAME = "Market Making Opportunities";
