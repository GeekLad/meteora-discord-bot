import { Connection } from "@solana/web3.js";
import { addMissingTransactions } from "./leaderboard";
import { SolanaParser } from "@debridge-finance/solana-transaction-parser";
import { IDL } from "@meteora-ag/dlmm";
import type { Idl } from "@project-serum/anchor";
import { METEORA_PROGRAM_ID } from "./config";

const CONNECTION = new Connection(process.env.SOLANA_RPC!);
const PARSER = new SolanaParser([
  { idl: IDL as Idl, programId: METEORA_PROGRAM_ID },
]);
const numAdded = await addMissingTransactions(CONNECTION, PARSER);
console.log(`Added ${numAdded} missing transactions`);
