import { Database } from "bun:sqlite";
import { getJupiterTokenList } from "./jupiter-token-list";
import { getMeteoraPairs } from "./meteora-markets";
import { type MeteoraTotalProfitData } from "./meteora-transactions";

export interface LeaderboardData {
  user_id: string;
  pair_name: string;
  pair_address: string;
  x_symbol: string;
  x_address: string;
  y_symbol: string;
  y_address: string;
  deposits: number;
  withdrawals: number;
  claimed_fees: number;
  profit: number;
  profitPercent: number;
}

const DB = new Database("leaderboard.sqlite", { create: true });
DB.exec("PRAGMA journal_mode = WAL;");
DB.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT NOT NULL,
  CONSTRAINT users_pk PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS wallets (
	id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	CONSTRAINT wallets_pk PRIMARY KEY (id),
	CONSTRAINT wallets_users_FK FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT
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
      $id: data.positionAddress,
      $pair_id: data.pairAddress,
      $wallet_id: data.ownerAddress,
      $deposits: data.depositsUsd,
      $withdrawals: data.withdrawalsUsd,
      $claimed_fees: data.claimedFeesUsd,
    });
    return 3;
  }
);
export const leaderboardQuery = DB.query(`
	SELECT
		u.id user_id,
		p.name pair_name,
		p.id pair_address,
		x.symbol x_symbol,
		x.id x_address,
		y.symbol y_symbol,
		y.id y_address,
		ps.deposits,
		ps.withdrawals,
		ps.claimed_fees,
		ps.withdrawals + ps.claimed_fees - ps.deposits profit,
		(ps.withdrawals + ps.claimed_fees - ps.deposits) / ps.deposits profitPercent
	FROM
		users u
		join wallets w on w.user_id = u.id
		join positions ps on ps.wallet_id = w.id 
		join pairs p on ps.pair_id = p.id
		join tokens_pairs tpx on tpx.pair_id = p.id and tpx.xy = 'x'
		join tokens_pairs tpy on tpy.pair_id = p.id and tpy.xy = 'y'
		join tokens x on x.id = tpx.token_id
		join tokens y on y.id = tpy.token_id
	ORDER BY 
		(ps.withdrawals + ps.claimed_fees - ps.deposits) / ps.deposits DESC
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
