import { Connection, PublicKey } from "@solana/web3.js";
import {
  SolanaParser,
  type ParsedAccount,
} from "@debridge-finance/solana-transaction-parser";
import { METEORA_API, METEORA_API_POSITION_ENDPOINT } from "./config";
import {
  getJupiterTokenList,
  lamportsToDecimal,
  type JupiterTokenListToken,
} from "./jupiter-token-list";
import DLMM, { type LbPosition } from "@meteora-ag/dlmm";
import { getPrices } from "./jupiter-price";
import pThrottle from "p-throttle";

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

interface MeteoraClaimFeesData {
  active_bin_id: number;
  onchain_timestamp: number;
  pair_address: string;
  position_address: string;
  price: number;
  token_x_amount: number;
  token_x_usd_amount: number;
  token_y_amount: number;
  token_y_usd_amount: number;
  tx_id: string;
}

interface MeteoraClaimRewardsData {
  onchain_timestamp: number;
  pair_address: string;
  position_address: string;
  reward_mint_address: string;
  token_amount: number;
  token_usd_amount: number;
  tx_id: string;
}

interface MeteoraPositionWithTransactions {
  position: MeteoraPositionData;
  deposits: MeteoraTransactionData[];
  withdraws: MeteoraTransactionData[];
  claim_fees: MeteoraClaimFeesData[];
  claim_rewards: MeteoraClaimRewardsData[];
}

interface MeteoraPositionMints {
  mintX: string;
  mintY: string;
  reward1Mint: string | null;
  reward2Mint: string | null;
}

interface MeteoraPositionWithTransactionMintsAndLbPosition
  extends MeteoraPositionWithTransactions {
  mints: MeteoraPositionMints;
  pair_name: string;
  lbPosition?: LbPosition;
}

export interface MeteoraPositionWithTransactionMintsAndCurrentValue
  extends MeteoraPositionWithTransactionMintsAndLbPosition {
  deposit_count: number;
  deposits_usd: number;
  withdraws_count: number;
  withdraws_usd: number;
  claimed_fees_count: number;
  claimed_fees_usd: number;
  claimed_rewards_count: number;
  claimed_rewards_usd: number;
  balances: MeteoraBalance[];
  average_balance: number;
  current_usd: number;
  unclaimed_fees_usd: number;
  unclaimed_rewards_usd: number;
  position_profit: number;
  total_profit: number;
}

interface MeteoraOpenPositionWithTransactionMintsAndCurrentValue
  extends MeteoraPositionWithTransactionMintsAndCurrentValue {
  lbPosition: LbPosition;
}

interface MeteoraBalanceChange {
  timestamp_ms: number;
  balance_change_usd: number;
}

interface MeteoraBalance {
  timestamp_position_open: number;
  timestamp_position_close: number;
  balance_age_ms: number;
  transaction_type: "deposit" | "withdraw";
  balance_change_usd: number;
  balance_usd: number;
}

// Set up throttles for RPC & Meteora API
const THROTTLE_RPC = pThrottle({
  limit: Number(process.env.RPC_MAX_TPS ?? 10),
  interval: 1000,
  onDelay: () => console.log("Throttling RPC requests..."),
});
const THROTTLE_METEORA_API = pThrottle({
  limit: Number(process.env.METEORA_API_MAX_TPS ?? 10),
  interval: 100,
  // onDelay: () => console.log("Throttling Meteora API requests..."),
});

function uniquePositions(positions: ParsedAccount[]): string[] {
  const positionStrings = positions.map((position) =>
    position.pubkey.toBase58()
  );
  return Array.from(new Set(positionStrings));
}

const getPositionAddresses = THROTTLE_RPC(
  async (
    connection: Connection,
    parser: SolanaParser,
    txSignature: string
  ): Promise<string[] | undefined> => {
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
    return uniquePositions(position);
  }
);

const fetchPosition = THROTTLE_METEORA_API((positionAddress: string) =>
  fetch(METEORA_API + METEORA_API_POSITION_ENDPOINT + "/" + positionAddress)
);
const fetchDeposits = THROTTLE_METEORA_API((positionAddress: string) =>
  fetch(
    METEORA_API +
      METEORA_API_POSITION_ENDPOINT +
      "/" +
      positionAddress +
      "/deposits"
  )
);
const fetchWithdraws = THROTTLE_METEORA_API((positionAddress: string) =>
  fetch(
    METEORA_API +
      METEORA_API_POSITION_ENDPOINT +
      "/" +
      positionAddress +
      "/withdraws"
  )
);
const fetchClaimFees = THROTTLE_METEORA_API((positionAddress: string) =>
  fetch(
    METEORA_API +
      METEORA_API_POSITION_ENDPOINT +
      "/" +
      positionAddress +
      "/claim_fees"
  )
);
const fetchClaimRewards = THROTTLE_METEORA_API((positionAddress: string) =>
  fetch(
    METEORA_API +
      METEORA_API_POSITION_ENDPOINT +
      "/" +
      positionAddress +
      "/claim_rewards"
  )
);
export async function getPositionData(
  positionAddress: string
): Promise<MeteoraPositionWithTransactions> {
  const [
    positionResponse,
    depositsResponse,
    withdrawsResponse,
    feesResponse,
    rewardsResponse,
  ] = await Promise.all([
    fetchPosition(positionAddress),
    fetchDeposits(positionAddress),
    fetchWithdraws(positionAddress),
    fetchClaimFees(positionAddress),
    fetchClaimRewards(positionAddress),
  ]);

  const [position, deposits, withdraws, claim_fees, claim_rewards] =
    await Promise.all([
      positionResponse.json() as unknown as MeteoraPositionData,
      depositsResponse.json() as unknown as MeteoraTransactionData[],
      withdrawsResponse.json() as unknown as MeteoraTransactionData[],
      feesResponse.json() as unknown as MeteoraClaimFeesData[],
      rewardsResponse.json() as unknown as MeteoraClaimRewardsData[],
    ]);

  return {
    position,
    deposits,
    withdraws,
    claim_fees,
    claim_rewards,
  };
}
const getPositions = THROTTLE_RPC(async (dlmmPool: DLMM, owner: string) => {
  return dlmmPool.getPositionsByUserAndLbPair(new PublicKey(owner));
});
async function getPositionMintsAndStatus(
  dlmmPool: DLMM,
  position: MeteoraPositionWithTransactions
): Promise<MeteoraPositionWithTransactionMintsAndLbPosition> {
  const mintX = dlmmPool.lbPair.tokenXMint.toBase58();
  const mintY = dlmmPool.lbPair.tokenYMint.toBase58();
  const reward1Mint =
    dlmmPool.lbPair.rewardInfos.length == 0
      ? null
      : dlmmPool.lbPair.rewardInfos[0].mint.toBase58();
  const reward2Mint =
    dlmmPool.lbPair.rewardInfos.length != 2
      ? null
      : dlmmPool.lbPair.rewardInfos[1].mint.toBase58();
  const openPositions = await getPositions(dlmmPool, position.position.owner);
  const positionCopy = JSON.parse(
    JSON.stringify(position)
  ) as MeteoraPositionWithTransactionMintsAndLbPosition;
  positionCopy.mints = {
    mintX,
    mintY,
    reward1Mint:
      reward1Mint == "11111111111111111111111111111111" ? null : reward1Mint,
    reward2Mint:
      reward2Mint == "11111111111111111111111111111111" ? null : reward2Mint,
  };
  if (openPositions.userPositions.length == 0) {
    return positionCopy;
  }
  const lbPosition = openPositions.userPositions.find(
    (openPosition) =>
      openPosition.publicKey.toBase58() == position.position.address
  );
  positionCopy.lbPosition = lbPosition;
  return positionCopy;
}

function getDlmm(
  position: MeteoraPositionWithTransactions,
  dlmms: DLMM[]
): DLMM {
  return dlmms.find(
    (dlmm) => position.position.pair_address == dlmm.pubkey.toBase58()
  )!;
}

const createDlmm = THROTTLE_RPC(
  async (connection: Connection, pair: string) => {
    return DLMM.create(connection, new PublicKey(pair));
  }
);
async function getPostionMintsAndStatuses(
  connection: Connection,
  positions: MeteoraPositionWithTransactions[]
): Promise<MeteoraPositionWithTransactionMintsAndLbPosition[]> {
  const uniquePairs = Array.from(
    new Set(positions.map((position) => position.position.pair_address))
  );
  const dlmms = await Promise.all(
    uniquePairs.map((pair) => createDlmm(connection, pair))
  );
  return Promise.all(
    positions.map((position) =>
      getPositionMintsAndStatus(getDlmm(position, dlmms), position)
    )
  );
}

function getUniqueMints(
  positions: MeteoraPositionWithTransactionMintsAndLbPosition[]
): string[] {
  const mints = positions
    .map((position) => {
      const mints: string[] = [];
      mints.push(position.mints.mintX);
      mints.push(position.mints.mintY);
      if (position.mints.reward1Mint != null) {
        mints.push(position.mints.reward1Mint);
      }
      if (position.mints.reward2Mint != null) {
        mints.push(position.mints.reward2Mint);
      }
      return mints;
    })
    .flat();
  return Array.from(new Set(mints));
}

function addClosedPositionTotals(
  position: MeteoraPositionWithTransactionMintsAndCurrentValue
) {
  position.deposit_count = position.deposits.length;
  position.deposits_usd = position.deposits
    .map((tx) => tx.token_x_usd_amount + tx.token_y_usd_amount)
    .reduce((total, current) => total + current);
  position.withdraws_count = position.withdraws.length;
  position.withdraws_usd =
    position.withdraws.length == 0
      ? 0
      : position.withdraws
          .map((tx) => tx.token_x_usd_amount + tx.token_y_usd_amount)
          .reduce((total, current) => total + current);
  position.claimed_fees_count = position.claim_fees.length;
  position.claimed_fees_usd =
    position.claim_fees.length == 0
      ? 0
      : position.claim_fees
          .map((tx) => tx.token_x_usd_amount + tx.token_y_usd_amount)
          .reduce((total, current) => total + current);
  position.claimed_rewards_count = position.claim_rewards.length;
  position.claimed_rewards_usd =
    position.claim_rewards.length == 0
      ? 0
      : position.claim_rewards
          .map((tx) => tx.token_usd_amount)
          .reduce((total, current) => total + current);
  position.current_usd = 0;
  position.unclaimed_fees_usd = 0;
  position.unclaimed_rewards_usd = 0;
}

function addBalances(
  position: MeteoraPositionWithTransactionMintsAndCurrentValue
) {
  const balanceChanges: MeteoraBalanceChange[] = position.deposits
    .map((tx) => {
      return {
        timestamp_ms: tx.onchain_timestamp * 1000,
        balance_change_usd: tx.token_x_usd_amount + tx.token_y_usd_amount,
      };
    })
    .concat(
      position.withdraws.map((tx) => {
        return {
          timestamp_ms: tx.onchain_timestamp * 1000,
          balance_change_usd: -tx.token_x_usd_amount - tx.token_y_usd_amount,
        };
      })
    )
    .sort((a, b) => a.timestamp_ms - b.timestamp_ms);

  position.balances = [];
  let priorBalance: MeteoraBalance | undefined = undefined;
  for (let i = 0; i < balanceChanges.length; i++) {
    let currentTx = balanceChanges[i];
    let nextTx =
      i + 1 < balanceChanges.length ? balanceChanges[i + 1] : undefined;
    let newBalance: MeteoraBalance = {
      timestamp_position_open: currentTx.timestamp_ms,
      timestamp_position_close: nextTx
        ? nextTx.timestamp_ms
        : currentTx.timestamp_ms,
      balance_age_ms: 0,
      transaction_type:
        currentTx.balance_change_usd > 0 ? "deposit" : "withdraw",
      balance_change_usd: currentTx.balance_change_usd,
      balance_usd: priorBalance
        ? priorBalance.balance_usd + currentTx.balance_change_usd
        : currentTx.balance_change_usd,
    };
    newBalance.balance_age_ms =
      newBalance.timestamp_position_close - newBalance.timestamp_position_open;
    position.balances.push(newBalance);
    priorBalance = newBalance;
  }
  const lastBalance = position.balances[position.balances.length - 1];
  if (position.lbPosition) {
    lastBalance.timestamp_position_close = new Date().getTime();
    lastBalance.balance_age_ms =
      lastBalance.timestamp_position_close -
      lastBalance.timestamp_position_open;
  }
}

function addAverageBalanceAndPositionProfit(
  position: MeteoraPositionWithTransactionMintsAndCurrentValue
) {
  let combinedBalance = position.balances
    .map((balance) => balance.balance_usd * balance.balance_age_ms)
    .reduce((total, current) => total + current);
  let totalTime = position.balances
    .map((balance) => balance.balance_age_ms)
    .reduce((total, current) => total + current);
  position.average_balance = combinedBalance / totalTime;
  position.position_profit =
    -position.balances[position.balances.length - 1].balance_usd;
  position.total_profit =
    position.position_profit +
    position.claimed_fees_usd +
    position.claimed_rewards_usd +
    position.current_usd +
    position.unclaimed_fees_usd +
    position.unclaimed_rewards_usd;
}

function addCurrentValue(
  tokenMap: Map<string, JupiterTokenListToken>,
  position: MeteoraOpenPositionWithTransactionMintsAndCurrentValue
) {
  position.current_usd =
    lamportsToDecimal(
      tokenMap.get(position.mints.mintX)!,
      Number(position.lbPosition.positionData.totalXAmount)
    ) +
    lamportsToDecimal(
      tokenMap.get(position.mints.mintY)!,
      Number(position.lbPosition.positionData.totalYAmount)
    );
  position.unclaimed_fees_usd =
    lamportsToDecimal(
      tokenMap.get(position.mints.mintX)!,
      Number(position.lbPosition.positionData.feeX)
    ) +
    lamportsToDecimal(
      tokenMap.get(position.mints.mintY)!,
      Number(position.lbPosition.positionData.feeY)
    );
  position.unclaimed_rewards_usd = 0;
  if (position.mints.reward1Mint) {
    position.unclaimed_rewards_usd += lamportsToDecimal(
      tokenMap.get(position.mints.reward1Mint)!,
      Number(position.lbPosition.positionData.rewardOne)
    );
  }
  if (position.mints.reward2Mint) {
    position.unclaimed_rewards_usd += lamportsToDecimal(
      tokenMap.get(position.mints.reward2Mint)!,
      Number(position.lbPosition.positionData.rewardTwo)
    );
  }
}

async function getPositionValues(
  positions: MeteoraPositionWithTransactionMintsAndLbPosition[]
): Promise<MeteoraPositionWithTransactionMintsAndCurrentValue[]> {
  const mints = getUniqueMints(positions);
  const [tokenMap, prices] = await Promise.all([
    getJupiterTokenList(fetch, "all"),
    getPrices(mints),
  ]);

  return positions.map((position) => {
    const positionCopy = JSON.parse(
      JSON.stringify(position)
    ) as MeteoraPositionWithTransactionMintsAndCurrentValue;
    positionCopy.pair_name = `${tokenMap.get(position.mints.mintX)!.symbol}-${
      tokenMap.get(position.mints.mintY)!.symbol
    }`;
    addClosedPositionTotals(positionCopy);
    if (positionCopy.lbPosition) {
      addCurrentValue(
        tokenMap,
        positionCopy as MeteoraOpenPositionWithTransactionMintsAndCurrentValue
      );
    }
    addBalances(positionCopy);
    addAverageBalanceAndPositionProfit(positionCopy);
    return positionCopy;
  });
}

export async function getPositionValuesFromPositionAddressesOrTransactionSignatures(
  connection: Connection,
  parser: SolanaParser,
  positionAddressesOrTransactionSignatures: string
): Promise<MeteoraPositionWithTransactionMintsAndCurrentValue[] | undefined> {
  const splitString = positionAddressesOrTransactionSignatures
    .trim()
    .split(/[,\s]+/);
  const positionAddressesProvided = splitString.filter(
    (str) => str.length == 44 || str.length == 43
  );
  const txIds = splitString.filter(
    (str) => str.length == 88 || str.length == 87
  );
  if (positionAddressesProvided.length == 0 && txIds.length == 0) {
    return undefined;
  }
  const positionAddressesFoundFromTransactionSignatures =
    txIds.length > 0
      ? ((
          await Promise.all(
            txIds.map((signature) =>
              getPositionAddresses(connection, parser, signature)
            )
          )
        )
          .filter((result) => !!result)
          .flat() as string[])
      : [];
  const positionAddresses = positionAddressesProvided.concat(
    positionAddressesFoundFromTransactionSignatures
  );
  const positionData = await Promise.all(
    positionAddresses.map((position) => getPositionData(position))
  );
  const positionMintsAndStatuses = await getPostionMintsAndStatuses(
    connection,
    positionData
  );
  return getPositionValues(positionMintsAndStatuses);
}
