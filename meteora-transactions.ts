import { Connection, PublicKey } from "@solana/web3.js";
import { SolanaParser } from "@debridge-finance/solana-transaction-parser";
import { METEORA_API, METEORA_API_POSITION_ENDPOINT } from "./config";

interface MeteoraPositionAddresses {
  positionAddress: PublicKey;
  poolAddress: PublicKey;
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

interface MeteoraPositionInfo {
  positionId: string;
  feesUsd: number;
  rewardsUsd: number;
  depositsUsd: number;
  withdrawalsUsd: number;
}

export async function getPositionTransactionTotalsFromSignature(
  connection: Connection,
  parser: SolanaParser,
  txSignature: string
): Promise<MeteoraPositionInfo | undefined> {
  const positionAddresses = await getPositionAddresses(
    connection,
    parser,
    txSignature
  );
  if (!positionAddresses) {
    return undefined;
  }
  return getPositionTransactionTotals(positionAddresses.positionAddress);
}

async function getPositionAddresses(
  connection: Connection,
  parser: SolanaParser,
  txSignature: string
): Promise<MeteoraPositionAddresses | undefined> {
  const tx = await parser.parseTransaction(connection, txSignature, false);
  if (tx == undefined) {
    return undefined;
  }
  const accounts = tx.map((data) => data.accounts).flat();
  const position = accounts.find((account) => account.name == "position");
  if (position == undefined) {
    return undefined;
  }
  const pool = accounts.find((account) => account.name == "lbPair");
  if (!pool) {
    return undefined;
  }
  const positionAddress = position.pubkey;
  const poolAddress = pool.pubkey;
  return {
    positionAddress,
    poolAddress,
  };
}

async function getPositionTransactionTotals(
  position: PublicKey
): Promise<MeteoraPositionInfo> {
  // const dlmmPool = await DLMM.create(connection, pool);
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
  const rewardsUsd = positionData.total_reward_usd_claimed;
  const depositsUsd = depositsData
    .map((deposit) => deposit.token_x_usd_amount + deposit.token_y_usd_amount)
    .reduce((total, current) => total + current);
  const withdrawalsUsd = withdrawalsData
    .map(
      (withdrawal) =>
        withdrawal.token_x_usd_amount + withdrawal.token_y_usd_amount
    )
    .reduce((total, current) => total + current);
  return {
    positionId: position.toBase58(),
    feesUsd,
    rewardsUsd,
    depositsUsd,
    withdrawalsUsd,
  };
}
