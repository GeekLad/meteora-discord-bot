import { Connection, PublicKey } from "@solana/web3.js";
import {
  SolanaParser,
  type ParsedAccount,
} from "@debridge-finance/solana-transaction-parser";
import { METEORA_API, METEORA_API_POSITION_ENDPOINT } from "./config";
import { getJupiterTokenList, lamportsToDecimal } from "./jupiter-token-list";
import DLMM from "@meteora-ag/dlmm";
import { getPrices } from "./jupiter-price";

interface MeteoraPositionAddresses {
  ownerAddress: PublicKey;
  poolAddress: PublicKey;
  positionAddress: PublicKey;
}

interface MeteoraPositionData {
  address: string;
  pair_address: string;
  owner: string;
  total_fee_x_claimed: number;
  total_fee_y_claimed: number;
  total_reward_x_claimed: number;
  total_reward_y_claimed: number;
  total_fee_usd_claimed: number;
  total_reward_usd_claimed: number;
  fee_apy_24h: number;
  fee_apr_24h: number;
  daily_fee_yield: number;
}

interface MeteoraTransactionData {
  tx_id: string;
  position_address: string;
  pair_address: string;
  active_bin_id: number;
  token_x_amount: number;
  token_y_amount: number;
  price: number;
  token_x_usd_amount: number;
  token_y_usd_amount: number;
  onchain_timestamp: number;
}

export interface MeteoraTotalProfitData {
  ownerAddress: string;
  positionAddresses: string[];
  pairAddress: string;
  positionIsOpen: boolean;
  mintX: string;
  mintY: string;
  depositsUsd: number;
  currentValueUsd: number;
  withdrawalsUsd: number;
  claimedFeesUsd: number;
  unclaimedFeesUsd: number;
  profitUsd: number;
  profitPercent: number;
}

interface MeteoraUnrealizedProfitData {
  positionIsOpen: boolean;
  positionAddresses: MeteoraPositionAddresses;
  mintX: string;
  mintY: string;
  currentValueUsd: number;
  unclaimedFeesUsd: number;
}

interface MeteoraRealizedProfitData {
  positionAddresses: MeteoraPositionAddresses;
  feesUsd: number;
  depositsUsd: number;
  withdrawalsUsd: number;
}

function combineRealizedProfits(
  realizedProfitData: MeteoraRealizedProfitData[]
): MeteoraTotalProfitData {
  const totalProfitData: MeteoraTotalProfitData = {
    ownerAddress:
      realizedProfitData[0].positionAddresses.ownerAddress.toBase58(),
    positionAddresses: realizedProfitData.map((data) =>
      data.positionAddresses.positionAddress.toBase58()
    ),
    pairAddress: realizedProfitData[0].positionAddresses.poolAddress.toBase58(),
    positionIsOpen: false,
    // The mints need to come from the unrealized profit data, these are just
    // placeholders to keep TypeScript happy
    mintX: "",
    mintY: "",
    currentValueUsd: 0,
    depositsUsd: 0,
    withdrawalsUsd: 0,
    claimedFeesUsd: 0,
    unclaimedFeesUsd: 0,
    profitUsd: 0,
    profitPercent: 0,
  };
  realizedProfitData.forEach((data) => {
    totalProfitData.depositsUsd += data.depositsUsd;
    totalProfitData.withdrawalsUsd += data.withdrawalsUsd;
    totalProfitData.claimedFeesUsd += data.feesUsd;
  });
  totalProfitData.profitUsd =
    totalProfitData.withdrawalsUsd +
    totalProfitData.claimedFeesUsd -
    totalProfitData.depositsUsd;
  totalProfitData.profitPercent =
    totalProfitData.profitUsd / totalProfitData.depositsUsd;
  return totalProfitData;
}

function combineUnrealizedProfits(
  unrealizedProfitData: MeteoraUnrealizedProfitData[],
  totalProfitData: MeteoraTotalProfitData
) {
  unrealizedProfitData.forEach((data) => {
    totalProfitData.currentValueUsd += data.currentValueUsd;
    totalProfitData.unclaimedFeesUsd += data.unclaimedFeesUsd;
    totalProfitData.profitUsd += data.currentValueUsd + data.unclaimedFeesUsd;
  });
}

export async function getTotalProfitDataFromSignature(
  connection: Connection,
  parser: SolanaParser,
  txSignature: string
): Promise<MeteoraTotalProfitData | undefined> {
  const realizedProfitData = await getPositionRealizedProfitDataFromSignature(
    connection,
    parser,
    txSignature
  );
  if (!realizedProfitData) {
    return undefined;
  }

  const totalProfitData = combineRealizedProfits(realizedProfitData);

  const unrealizedProfitData = await Promise.all(
    realizedProfitData.map((data) =>
      getPositionUnrealizedProfitData(connection, data.positionAddresses)
    )
  );
  // Update the mints
  totalProfitData.mintX = unrealizedProfitData[0].mintX;
  totalProfitData.mintY = unrealizedProfitData[0].mintY;
  if (
    // If all positions are closed, then go with the unrealized profit data
    !unrealizedProfitData
      .map((data) => data.positionIsOpen)
      .reduce((total, current) => total || current)
  ) {
    return totalProfitData;
  }
  totalProfitData.positionIsOpen = true;

  // Update the total profit data w/ the unrealized profit data
  combineUnrealizedProfits(unrealizedProfitData, totalProfitData);
  totalProfitData.profitPercent =
    totalProfitData.profitUsd / totalProfitData.depositsUsd;
  return totalProfitData;
}

async function getPositionUnrealizedProfitData(
  connection: Connection,
  positionAddresses: MeteoraPositionAddresses
): Promise<MeteoraUnrealizedProfitData> {
  // See if we even have any positions
  const dlmmPool = await DLMM.create(connection, positionAddresses.poolAddress);
  const mintX = dlmmPool.lbPair.tokenXMint.toBase58();
  const mintY = dlmmPool.lbPair.tokenYMint.toBase58();
  const noData: MeteoraUnrealizedProfitData = {
    positionIsOpen: false,
    positionAddresses,
    mintX,
    mintY,
    currentValueUsd: 0,
    unclaimedFeesUsd: 0,
  };
  const openPositions = await dlmmPool.getPositionsByUserAndLbPair(
    positionAddresses.ownerAddress
  );
  if (openPositions.userPositions.length == 0) {
    return noData;
  }

  // Find the position we're looking for
  const lbPosition = openPositions.userPositions.find(
    (lbPosition) =>
      lbPosition.publicKey.toBase58() ==
      positionAddresses.positionAddress.toBase58()
  );
  if (!lbPosition) {
    return noData;
  }

  // Get the token map and prices so we can convert the price data from the
  // lbPosition
  const [tokenMap, prices] = await Promise.all([
    getJupiterTokenList(fetch, "all"),
    getPrices([mintX, mintY]),
  ]);
  const [priceX, priceY] = prices;
  const tokenX = tokenMap.get(mintX);
  const tokenY = tokenMap.get(mintY);
  if (!tokenX || !tokenY) {
    return noData;
  }
  const xAmount = lamportsToDecimal(
    tokenX,
    Number(lbPosition.positionData.totalXAmount)
  );
  const yAmount = lamportsToDecimal(
    tokenY,
    Number(lbPosition.positionData.totalYAmount)
  );
  const currentValueUsd = xAmount * priceX.price + yAmount * priceY.price;
  const xFees = lamportsToDecimal(tokenX, lbPosition.positionData.feeX);
  const yFees = lamportsToDecimal(tokenY, lbPosition.positionData.feeY);
  const unclaimedFeesUsd = xFees * priceX.price + yFees * priceY.price;
  return {
    positionIsOpen: true,
    positionAddresses,
    mintX,
    mintY,
    currentValueUsd,
    unclaimedFeesUsd,
  };
}

async function getPositionRealizedProfitDataFromSignature(
  connection: Connection,
  parser: SolanaParser,
  txSignature: string
): Promise<MeteoraRealizedProfitData[] | undefined> {
  const positionAddresses = await getPositionAddresses(
    connection,
    parser,
    txSignature
  );
  if (!positionAddresses) {
    return undefined;
  }
  return Promise.all(
    positionAddresses.map((positionAddress) =>
      getPositionRealizedProfit(positionAddress)
    )
  );
}

function uniquePositions(positions: ParsedAccount[]): PublicKey[] {
  const positionStrings = positions.map((position) =>
    position.pubkey.toBase58()
  );
  const uniqueStrings = Array.from(new Set(positionStrings));
  return uniqueStrings.map((position) => new PublicKey(position));
}

async function getPositionAddresses(
  connection: Connection,
  parser: SolanaParser,
  txSignature: string
): Promise<MeteoraPositionAddresses[] | undefined> {
  const tx = await parser.parseTransaction(connection, txSignature, false);
  if (tx == undefined) {
    return undefined;
  }
  const accounts = tx.map((data) => data.accounts).flat();
  const owner = accounts.find((account) => account.name == "sender");
  const pool = accounts.find((account) => account.name == "lbPair");
  const position = accounts.filter((account) => account.name == "position");
  if (!owner || !pool || !position) {
    return undefined;
  }
  const positionAddresses = uniquePositions(position);
  const poolAddress = pool.pubkey;
  const ownerAddress = owner.pubkey;
  return positionAddresses.map((positionAddress) => {
    return {
      ownerAddress,
      poolAddress,
      positionAddress,
    };
  });
}

async function getPositionRealizedProfit(
  positionAddresses: MeteoraPositionAddresses
): Promise<MeteoraRealizedProfitData> {
  const position = positionAddresses.positionAddress;
  const [positionResponse, depositsResponse, withdrawalsResponse] =
    await Promise.all([
      fetch(
        METEORA_API + METEORA_API_POSITION_ENDPOINT + "/" + position.toBase58()
      ),
      fetch(
        METEORA_API +
          METEORA_API_POSITION_ENDPOINT +
          "/" +
          position.toBase58() +
          "/deposits"
      ),
      fetch(
        METEORA_API +
          METEORA_API_POSITION_ENDPOINT +
          "/" +
          position.toBase58() +
          "/withdraws"
      ),
    ]);

  const [positionData, depositsData, withdrawalsData] = await Promise.all([
    positionResponse.json() as unknown as MeteoraPositionData,
    depositsResponse.json() as unknown as MeteoraTransactionData[],
    withdrawalsResponse.json() as unknown as MeteoraTransactionData[],
  ]);

  const feesUsd = positionData.total_fee_usd_claimed;
  const depositsUsd = depositsData
    .map((deposit) => deposit.token_x_usd_amount + deposit.token_y_usd_amount)
    .reduce((total, current) => total + current);
  const withdrawalsUsd =
    withdrawalsData.length > 0
      ? withdrawalsData
          .map(
            (withdrawal) =>
              withdrawal.token_x_usd_amount + withdrawal.token_y_usd_amount
          )
          .reduce((total, current) => total + current)
      : 0;
  return {
    positionAddresses,
    feesUsd,
    depositsUsd,
    withdrawalsUsd,
  };
}
