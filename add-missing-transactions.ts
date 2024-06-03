import { addMissingTransactions } from "./leaderboard";

const numAdded = await addMissingTransactions();
console.log(`Added ${numAdded} missing transactions`);
