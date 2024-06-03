import { Database } from "bun:sqlite";
import { getJupiterTokenList } from "./jupiter-token-list";
import { getMeteoraPairs } from "./meteora-markets";
import {
  getPositionRealizedProfit,
  type MeteoraPositionAddresses,
  type MeteoraRealizedProfitData,
  type MeteoraTotalProfitData,
} from "./meteora-transactions";
import { PublicKey } from "@solana/web3.js";

export interface LeaderboardData {
  user_id: string;
  position_id: string;
  pair_name: string;
  pair_address: string;
  x_symbol: string;
  x_address: string;
  y_symbol: string;
  y_address: string;
  position_minutes_open: number;
  position_hours_open: number;
  position_days_open: number;
  deposits: number;
  deposit_count: number;
  withdrawals: number;
  withdrawal_count: number;
  claimed_fees: number;
  mean_balance: number;
  position_profit: number;
  net_profit: number;
  profit_percent: number;
}

const DB = new Database("leaderboard.sqlite", { create: true });
DB.exec("PRAGMA journal_mode = WAL;");
DB.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT NOT NULL,
  CONSTRAINT users_pk PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS wallets (
	id TEXT(44) NOT NULL,
	user_id TEXT NOT NULL,
	CONSTRAINT wallets_pk PRIMARY KEY (id),
	CONSTRAINT wallets_users_FK FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE RESTRICT
);
CREATE TABLE IF NOT EXISTS pairs (
	id TEXT(44) NOT NULL,
	name INTEGER,
	CONSTRAINT pairs_pk PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS tokens (
	id TEXT(44) NOT NULL,
	symbol TEXT,
	CONSTRAINT tokens_pk PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS tokens_pairs (
	token_id TEXT(44) NOT NULL,
	pair_id TEXT(44) NOT NULL,
	xy TEXT(1) NOT NULL,
	CONSTRAINT tokens_pairs_pk PRIMARY KEY (token_id, pair_id)
	CONSTRAINT tokens_pairs_tokens_FK FOREIGN KEY (token_id) REFERENCES tokens(id) ON UPDATE RESTRICT,
	CONSTRAINT tokens_pairs_pairs_FK FOREIGN KEY (pair_id) REFERENCES pairs(id) ON UPDATE RESTRICT
);
CREATE TABLE IF NOT EXISTS positions (
	id TEXT(44) NOT NULL,
	pair_id TEXT(44) NOT NULL,
	wallet_id TEXT(44) NOT NULL,
	deposits NUMERIC DEFAULT (0) NOT NULL,
	withdrawals NUMERIC DEFAULT (0) NOT NULL,
	claimed_fees NUMERIC DEFAULT (0) NOT NULL,
	CONSTRAINT positions_pk PRIMARY KEY (id),
	CONSTRAINT positions_pairs_FK FOREIGN KEY (pair_id) REFERENCES pairs(id) ON UPDATE RESTRICT,
	CONSTRAINT positions_wallets_FK FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE TABLE IF NOT EXISTS transactions (
	onchain_timestamp INTEGER NOT NULL,
	id TEXT(44) NOT NULL,
	position_id TEXT(44) NOT NULL,
	usd_balance_change NUMERIC NOT NULL,
	CONSTRAINT transactions_pk PRIMARY KEY (id),
	CONSTRAINT transactions_positions_FK FOREIGN KEY ("position_id") REFERENCES positions(id) ON UPDATE RESTRICT
);
`);

const loadTokenQuery = DB.query(
  "INSERT INTO tokens (id, symbol) VALUES ($address, $symbol) ON CONFLICT DO NOTHING"
);
const loadPairQuery = DB.query(`
	INSERT INTO pairs (id, name) VALUES ($address, $name) ON CONFLICT DO NOTHING;
`);
const loadTokenPairQuery = DB.query(`
	INSERT INTO tokens_pairs (token_id, pair_id, xy) VALUES ($mint, $address, $xy) ON CONFLICT DO NOTHING;
`);
const loadUserQuery = DB.query(
  "INSERT INTO users (id) VALUES ($id) ON CONFLICT DO NOTHING"
);
const loadWalletQuery = DB.query(
  "INSERT INTO wallets (id, user_id) VALUES ($id, $user_id) ON CONFLICT DO NOTHING"
);
const loadPositionQuery = DB.query(`
	INSERT INTO positions (
		id, 
		pair_id, 
		wallet_id, 
		deposits, 
		withdrawals, 
		claimed_fees
	) VALUES (
		$id, 
		$pair_id, 
		$wallet_id, 
		$deposits, 
		$withdrawals, 
		$claimed_fees
	) 
	ON CONFLICT DO UPDATE SET
		pair_id = $pair_id,
		wallet_id = $wallet_id,
		deposits = $deposits,
		withdrawals = $withdrawals,
		claimed_fees = $claimed_fees
	WHERE
		id = $id
`);
const loadTransactionsQuery = DB.query(`
  INSERT INTO transactions (
    onchain_timestamp,
    id,
    position_id,
    usd_balance_change
  ) VALUES(
    $onchain_timestamp,
    $id,
    $position_id,
    $usd_balance_change
  )
  ON CONFLICT DO NOTHING;
`);
const getPositionsMissingTransactions = DB.query(`
  SELECT
    p.wallet_id,
    p.pair_id,
    p.id
  FROM
    positions p
  WHERE
    p.id not in (SELECT position_id FROM transactions)
`);
function loadDepositsWithdrawals(
  data: MeteoraTotalProfitData | MeteoraRealizedProfitData
) {
  data.transactions.deposits.forEach((deposit) => {
    loadTransactionsQuery.run({
      $onchain_timestamp: deposit.onchain_timestamp,
      $id: deposit.tx_id,
      $position_id: deposit.position_address,
      $usd_balance_change:
        deposit.token_x_usd_amount + deposit.token_y_usd_amount,
    });
  });
  data.transactions.withdrawals.forEach((withdrwal) => {
    loadTransactionsQuery.run({
      $onchain_timestamp: withdrwal.onchain_timestamp,
      $id: withdrwal.tx_id,
      $position_id: withdrwal.position_address,
      $usd_balance_change:
        -withdrwal.token_x_usd_amount - withdrwal.token_y_usd_amount,
    });
  });
  return (
    data.transactions.deposits.length + data.transactions.withdrawals.length
  );
}

const loadProfitTransaction = DB.transaction(
  (userId: string, data: MeteoraTotalProfitData) => {
    loadUserQuery.run({
      $id: userId,
    });
    loadWalletQuery.run({
      $id: data.ownerAddress,
      $user_id: userId,
    });
    loadPositionQuery.run({
      $id: data.positionAddresses[0],
      $pair_id: data.pairAddress,
      $wallet_id: data.ownerAddress,
      $deposits: data.depositsUsd,
      $withdrawals: data.withdrawalsUsd,
      $claimed_fees: data.claimedFeesUsd,
    });
    return 3 + loadDepositsWithdrawals(data);
  }
);
export const leaderboardQuery = DB.query(`
  WITH balances as (
    SELECT
      position_id,
      onchain_timestamp,
      CASE WHEN usd_balance_change > 0 THEN 1 ELSE 0 END deposit_count,
      CASE WHEN usd_balance_change < 0 THEN 1 ELSE 0 END withdrawal_count,
      COALESCE (LEAD(onchain_timestamp) OVER (PARTITION BY position_id ORDER BY onchain_timestamp) - onchain_timestamp, 0) time_elapsed,
      COALESCE (SUM(usd_balance_change) OVER (PARTITION BY position_id ORDER BY onchain_timestamp), usd_balance_change) balance
    FROM
      transactions
  ),
  time_weighted_balances as (
    SELECT
      position_id,
      MIN(onchain_timestamp) onchain_timestamp_position_open,
      MAX(onchain_timestamp) onchain_timestamp_position_close,
      SUM(deposit_count) deposit_count,
      SUM(withdrawal_count) withdrawal_count,
      CASE 
        WHEN MOD(SUM(time_elapsed), 60) > 30 THEN 1
        ELSE 0
      END + MOD(SUM(time_elapsed)/ 60, 60) position_minutes_open,
      MOD(SUM(time_elapsed) / (60*60), 24) position_hours_open,
      SUM(time_elapsed) / (60*60*24) position_days_open,
      SUM(time_elapsed*balance) / SUM(time_elapsed) mean_balance,
      -SUM(case when time_elapsed = 0 then balance else 0 end) position_profit
    FROM
      balances
    GROUP BY
      position_id
  ),
  leaderboard as (
    SELECT
      u.id user_id,
      ps.id position_id,
      p.name pair_name,
      p.id pair_address,
      x.symbol x_symbol,
      x.id x_address,
      y.symbol y_symbol,
      y.id y_address,
      ps.deposits,
      ps.withdrawals,
      ps.claimed_fees,
      ps.withdrawals + ps.claimed_fees - ps.deposits net_profit,
      (ps.withdrawals + ps.claimed_fees - ps.deposits) / ps.deposits profit_percent
    FROM
      users u
      join wallets w on w.user_id = u.id
      join positions ps on ps.wallet_id = w.id 
      join pairs p on ps.pair_id = p.id
      join tokens_pairs tpx on tpx.pair_id = p.id and tpx.xy = 'x'
      join tokens_pairs tpy on tpy.pair_id = p.id and tpy.xy = 'y'
      join tokens x on x.id = tpx.token_id
      join tokens y on y.id = tpy.token_id
  )
  SELECT 
    l.user_id,
    l.position_id,
    l.pair_name,
    l.pair_address,
    l.x_symbol,
    l.x_address,
    l.y_symbol,
    l.y_address,
    b.position_minutes_open,
    b.position_hours_open,
    b.position_days_open,
    l.deposits,
    b.deposit_count,
    l.withdrawals,
    b.withdrawal_count,
    l.claimed_fees,
    b.mean_balance,
    b.position_profit,
    l.net_profit,
    l.profit_percent
  FROM 
    time_weighted_balances b
    JOIN leaderboard l ON l.position_id = b.position_id
  ORDER BY
    l.profit_percent DESC
`);

const getTokenQuery = DB.query(`
	SELECT * FROM tokens WHERE id = $address
`);

export async function loadTokens() {
  console.log("Loading tokens into leaderboard database");
  const tokenMap = await getJupiterTokenList(fetch, "all");
  tokenMap.forEach((token) => {
    loadTokenQuery.run({
      $address: token.address,
      $symbol: token.symbol,
    });
  });
  console.log("Tokens loaded");
}

export async function loadPairs() {
  console.log("Loading pairs into leaderboard database");
  const pairs = await getMeteoraPairs(fetch);
  pairs.forEach((pair) => {
    loadPairQuery.run({
      $address: pair.address,
      $name: pair.name,
    });
    loadTokenPairQuery.run({
      $mint: pair.mint_x,
      $address: pair.address,
      $xy: "x",
    });
    loadTokenPairQuery.run({
      $mint: pair.mint_y,
      $address: pair.address,
      $xy: "y",
    });
  });
  console.log("Pairs loaded");
}

async function addPair(data: MeteoraTotalProfitData) {
  const tokens = await getJupiterTokenList(fetch, "all");
  const xToken = tokens.get(data.mintX);
  const yToken = tokens.get(data.mintY);
  loadTokenQuery.run({
    $address: xToken!.address,
    $symbol: xToken!.symbol,
  });
  loadTokenQuery.run({
    $address: yToken!.address,
    $symbol: yToken!.symbol,
  });
  const pairs = await getMeteoraPairs(fetch);
  const pair = pairs.find((p) => p.address == data.pairAddress)!;
  loadPairQuery.run({
    $address: data.pairAddress,
    $name: pair.name,
  });
  loadTokenPairQuery.run({
    $mint: pair.mint_x,
    $address: pair.address,
    $xy: "x",
  });
  loadTokenPairQuery.run({
    $mint: pair.mint_y,
    $address: pair.address,
    $xy: "y",
  });
}

export async function addPositionProfitData(
  userId: string,
  data: MeteoraTotalProfitData
) {
  let xTokenRecord = getTokenQuery.get({ $address: data.mintX });
  let yTokenRecord = getTokenQuery.get({ $address: data.mintY });
  if (xTokenRecord == null || yTokenRecord == null) {
    await addPair(data);
  }
  loadProfitTransaction(userId, data);
}

export async function addMissingTransactions() {
  const positionIds = getPositionsMissingTransactions.all() as [
    {
      wallet_id: string;
      pair_id: string;
      id: string;
    }
  ];
  const missingTransactionProfitData = await Promise.all(
    positionIds.map(async (data) => {
      const position: MeteoraPositionAddresses = {
        ownerAddress: new PublicKey(data.wallet_id),
        poolAddress: new PublicKey(data.pair_id),
        positionAddress: new PublicKey(data.id),
      };
      return getPositionRealizedProfit(position);
    })
  );
  let numTransactions = 0;
  missingTransactionProfitData.forEach((profitData) => {
    numTransactions += loadDepositsWithdrawals(profitData);
  });
  return numTransactions;
}
