import {
  ApplicationCommandOptionType,
  ChatInputCommandInteraction,
  Client,
  IntentsBitField,
  User,
  type APIEmbed,
  type ApplicationCommandDataResolvable,
  type Interaction,
} from "discord.js";
import {
  addStrictFlagToAllSolanaOpportunities,
  getOpportunities,
  type AllSolanaOpportunitesEnriched,
  type OpportunityData,
} from "./opportunity-finder";
import type { DexScreenerToken } from "./dex-screener";
import {
  BLUE_CHIPS,
  DUNE_QUERY_ID,
  METEORA_PROGRAM_ID,
  REFRESHING_MESSAGE,
} from "./config";
import { getJupiterTokenList } from "./jupiter-token-list";
import {
  getAllSolanaOpportunities,
  refreshAllSolanaOpportunities,
} from "./dune";
import { DuneClient } from "@duneanalytics/client-sdk";
import { Connection } from "@solana/web3.js";
import { type Idl } from "@project-serum/anchor";
import { IDL } from "@meteora-ag/dlmm";
import { SolanaParser } from "@debridge-finance/solana-transaction-parser";
import { getTotalProfitDataFromSignature } from "./meteora-transactions";
import {
  addPositionProfitData,
  leaderboardQuery,
  loadPairs,
  loadTokens,
  type LeaderboardData,
} from "./leaderboard";

interface MeteoraBotOpportunityData {
  updated: number;
  data: OpportunityData[];
}

interface MeteoraBotCommand {
  commandData: ApplicationCommandDataResolvable;
  fn: (interaction: ChatInputCommandInteraction) => any | Promise<any>;
  parameters?: string[];
  helpText: string;
}

// Set up stats tracking
const DISCORD_BOT_STATS = {
  startTime: new Date().getTime(),
  interactions: 0,
  refreshCount: 0,
  duneRefreshCount: 0,
};

// Verify the required environment variables
const environmentErrors: string[] = [];

if (!process.env.DISCORD_BOT_TOKEN) {
  environmentErrors.push("DISCORD_BOT_TOKEN environment variable missing.");
}
if (!process.env.DUNE_API_KEY) {
  environmentErrors.push("DUNE_API_KEY environment variable missing.");
}
if (!process.env.SOLANA_RPC) {
  environmentErrors.push("SOLANA_RPC environment variable missing.");
}
if (environmentErrors.length > 0) {
  throw new Error(
    "Unable to start bot, environment not configured properly.\n" +
      environmentErrors.join("\n")
  );
}

// Instantiate the Discord client
const DISCORD_CLIENT = new Client({
  intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMessages],
});

// Instantiate the Dune client
const DUNE_CLIENT = new DuneClient(process.env.DUNE_API_KEY!);

// Set up opportunity data refresh
const DLMM_REFRESH_MS = process.env.DLMM_REFRESH_MINUTES
  ? Number(process.env.DLMM_REFRESH_MINUTES) * 60 * 1000
  : 15 * 60 * 1000;
const DUNE_REFRESH_MS = process.env.DUNE_REFRESH_MINUTES
  ? Number(process.env.DUNE_REFRESH_MINUTES) * 60 * 1000
  : 60 * 60 * 1000;

let DLMM_OPPORTUNITY_DATA: MeteoraBotOpportunityData = {
  updated: 0,
  data: [],
};
const ENABLE_DUNE_REFRESH = Boolean(process.env.ENABLE_DUNE_REFRESH);
let SOLANA_OPPORTUNITY_DATA: AllSolanaOpportunitesEnriched[] = [];

// Set up the RPC and transaction parser
const CONNECTION = new Connection(process.env.SOLANA_RPC!);
const PARSER = new SolanaParser([
  { idl: IDL as Idl, programId: METEORA_PROGRAM_ID },
]);

// Load new tokens & pairs into the database
await loadTokens();
await loadPairs();

async function refreshDlmmOpportunities() {
  console.log(`${new Date().toLocaleTimeString()}: Refreshing DLMM data`);
  const tokenMap = await getJupiterTokenList();
  try {
    const data = await getOpportunities(tokenMap);
    DLMM_OPPORTUNITY_DATA = {
      updated: new Date().getTime() / 1000,
      data,
    };
    DISCORD_BOT_STATS.refreshCount++;
    console.log(
      `${new Date().toLocaleTimeString()}: Data refreshed ${
        DISCORD_BOT_STATS.refreshCount
      } times`
    );
  } catch (err) {
    console.error(err);
    console.error(
      `${new Date().toLocaleTimeString()}: Retrying refresh in 30 seconds...`
    );
    DLMM_OPPORTUNITY_DATA = {
      updated: 0,
      data: [],
    };
    setInterval(refreshDlmmOpportunities, 30 * 1000);
  }
}

async function refreshAll() {
  console.log(`${new Date().toLocaleTimeString()}: Refreshing Dune data`);
  if (ENABLE_DUNE_REFRESH) {
    await refreshAllSolanaOpportunities(DUNE_CLIENT);
  }
  const [data, tokenMap] = await Promise.all([
    getAllSolanaOpportunities(DUNE_CLIENT),
    getJupiterTokenList(),
  ]);
  if (data) {
    const enrichedData = data as AllSolanaOpportunitesEnriched[];
    addStrictFlagToAllSolanaOpportunities(tokenMap, enrichedData);
    SOLANA_OPPORTUNITY_DATA = enrichedData;
    DISCORD_BOT_STATS.duneRefreshCount++;
    console.log(
      `${new Date().toLocaleTimeString()}: Dune data refreshed ${
        DISCORD_BOT_STATS.duneRefreshCount
      } times`
    );
  } else {
    SOLANA_OPPORTUNITY_DATA = [];
    console.error(
      `${new Date().toLocaleTimeString()}: No results in Dune refresh.`
    );
    console.error(
      `${new Date().toLocaleTimeString()}: Retrying refresh in 30 seconds...`
    );
    setInterval(() => refreshAllSolanaOpportunities(DUNE_CLIENT), 30 * 1000);
  }
}

function sendHelp(interaction: ChatInputCommandInteraction) {
  const commands: string[] = [];
  COMMANDS.forEach((command, name) => {
    commands.push(
      `**/${name}${
        command.parameters ? " *" + command.parameters.join(" ") + "*" : ""
      }**: ${command.helpText}`
    );
  });
  interaction.reply({
    embeds: [
      {
        title: "Meteora Bot Help",
        description: commands.join("\n\n"),
        color: 3329330,
      },
    ],
  });
}

function rugCheck(token: DexScreenerToken): string {
  if (!BLUE_CHIPS.includes(token.symbol.toLowerCase())) {
    return `[${token.symbol}](https://rugcheck.xyz/tokens/${token.address})`;
  }
  return "";
}

function singleOpportunityMessage(
  opty: OpportunityData,
  estimationmode: "min" | "max"
): string {
  const pairAddress = opty.pairAddress;
  const pairName = opty.pairName;
  const feestoTvl =
    estimationmode == "min"
      ? opty.feeToTvl.min.toLocaleString("en-US", {
          style: "percent",
          maximumFractionDigits: 2,
        })
      : opty.feeToTvl.max.toLocaleString("en-US", {
          style: "percent",
          maximumFractionDigits: 2,
        });

  const liquidity = opty.liquidity.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  const binStep = opty.binStep;
  const baseFee = opty.baseFee.toLocaleString("en-US", {
    style: "percent",
    maximumFractionDigits: 2,
  });
  const fdv = opty.fdv
    ? opty.fdv.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      })
    : "";
  const trend = opty.trend == "Up" ? "⬆️" : "⬇️";
  const message = `**[${pairName}](https://app.meteora.ag/dlmm/${pairAddress})** 🖨 ${feestoTvl} 📈 ${trend} 💰 ${liquidity}${
    fdv != "" ? ` 🌏 ${fdv}` : ""
  } 🪜 ${binStep} 💵 ${baseFee}`;
  const rugChecks = [rugCheck(opty.base), rugCheck(opty.quote)];
  if (rugChecks[0] != "" && rugChecks[1] != "") {
    return message + " ✅ " + rugChecks.join(", ");
  }
  if (rugChecks[0] != "") {
    return message + " ✅ " + rugChecks[0];
  }
  if (rugChecks[1] != "") {
    return message + " ✅ " + rugChecks[1];
  }
  return message;
}

function isDegen(opty: OpportunityData): boolean {
  return !opty.strict;
}

function isStrict(opty: OpportunityData): boolean {
  return opty.strict;
}

function isBlueChip(opty: OpportunityData): boolean {
  return (
    opty.strict &&
    BLUE_CHIPS.includes(opty.base.symbol.toLowerCase()) &&
    BLUE_CHIPS.includes(opty.quote.symbol.toLowerCase())
  );
}

function addHeading(
  messages: string[],
  blueChip: boolean,
  estimationMode: "min" | "max"
) {
  messages.unshift(
    `**Pair Name**\n🖨 Estimated ${
      estimationMode == "min" ? "Minimum" : "Maximum"
    } 24H Fees / TVL\n📈 Volume Trend\n💰 Market TVL\n🌏 FDV\n🪜 Bin Step\n💵 Base Fee${
      !blueChip ? "\n✅ Rug Check" : ""
    }`
  );
}

function createOpportunityEmbedding(
  minliquidity: number,
  strict = false,
  blueChip = false,
  estimationmode: "min" | "max" = "min",
  minfdv = 0,
  uptrendonly = false
): APIEmbed {
  if (DLMM_OPPORTUNITY_DATA.data.length == 0) {
    return REFRESHING_MESSAGE;
  }

  const opportunities = DLMM_OPPORTUNITY_DATA.data
    // Filters
    .filter(
      (opty) =>
        opty.liquidity > minliquidity &&
        (minfdv == 0 || (minfdv != 0 && opty.fdv && opty.fdv >= minfdv)) &&
        (!uptrendonly || (uptrendonly && opty.trend == "Up")) &&
        ((!strict && isDegen(opty)) ||
          (strict && !blueChip && isStrict(opty)) ||
          (strict && blueChip && isBlueChip(opty)))
    )
    // Sort by min or max
    .sort((a, b) => {
      if (estimationmode == "min") {
        return b.feeToTvl.min - a.feeToTvl.min;
      }
      return b.feeToTvl.max - a.feeToTvl.max;
    })
    // Trim down to limit the message size
    .slice(0, 10);

  if (opportunities.length == 0) {
    return {
      title: `No Results`,
      color: 3329330,
      description: `No pairs found matching your parameters`,
    };
  }

  const messages = opportunities
    // Generate the messages
    .map((opty) => singleOpportunityMessage(opty, estimationmode));

  // Add the heading and combine the message array into a string
  addHeading(messages, blueChip, estimationmode);
  const description = messages.join("\n\n");

  // Build the API embedding
  return {
    title: `Top ${messages.length - 1} ${
      !strict ? "Non-Strict List" : !blueChip ? "Strict List" : "Blue Chip"
    } DLMM Opportunities\nLiquidity: ${minliquidity.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    })} or more\n${
      minfdv > 0
        ? `FDV: ${minfdv.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          })} or more\n`
        : ""
    }${
      uptrendonly ? "Up-trending Volume Pairs\n" : ""
    }Last updated <t:${Math.round(DLMM_OPPORTUNITY_DATA.updated)}:R>`,
    description,
    color: 3329330,
  };
}

function getEstimationMode(
  interaction: ChatInputCommandInteraction
): "min" | "max" | "" {
  const estimationmode = interaction.options.get("estimationmode")
    ? (interaction.options.get("estimationmode")!.value as string)
        .trim()
        .toLowerCase()
    : "min";

  if (estimationmode != "min" && estimationmode != "max") {
    interaction.reply({
      embeds: [
        {
          title: "Invalid Estimation Mode",
          description: "Estimation mode must be min or max",
        },
      ],
    });
    return "";
  }
  return estimationmode;
}

async function sendOpportunities(
  interaction: ChatInputCommandInteraction,
  strict: boolean,
  blueChip = false
) {
  const optyType = blueChip ? "bluechip" : strict ? "strict" : "degen";
  const minliquidity = interaction.options.get("minliquidity")
    ? (interaction.options.get("minliquidity")!.value as number)
    : 600;
  const minfdv = interaction.options.get("minfdv")
    ? (interaction.options.get("minfdv")!.value as number)
    : 0;
  const estimationmode = getEstimationMode(interaction);
  const uptrendonly = interaction.options.get("uptrendonly")
    ? Boolean(interaction.options.get("uptrendonly")?.value)
    : false;

  if (estimationmode == "") {
    return;
  }

  const embeds = [
    createAllOpportunityEmbed(optyType),
    createOpportunityEmbedding(
      minliquidity,
      strict,
      blueChip,
      estimationmode,
      minfdv,
      uptrendonly
    ),
  ];
  interaction.reply({
    embeds,
  });
}

function invalidPir(pairName: string): APIEmbed {
  return {
    title: "Invalid pair",
    description: `${pairName} isn't a valid pair.  Pair name should be formatted as \`TOKEN1-TOKEN2\``,
    color: 3329330,
  };
}

function createPairEmbedding(
  pairName: string,
  estimationmode: "min" | "max"
): APIEmbed {
  const symbols = pairName
    .toLowerCase()
    .trim()
    .split(/[-/\s]/);
  if (symbols.length != 2) {
    return invalidPir(pairName);
  }
  const pairs = DLMM_OPPORTUNITY_DATA.data.filter(
    (opty) =>
      symbols.includes(opty.base.symbol.toLowerCase()) &&
      symbols.includes(opty.quote.symbol.toLowerCase())
  );

  if (pairs.length == 0) {
    return {
      title: "No Pairs Found",
      description: `There weren't any pairs for ${pairName} found`,
      color: 3329330,
    };
  }

  const messages = pairs
    // Trim down to limit the message size
    .slice(0, 10)
    // Generate the messages
    .map((opty) => singleOpportunityMessage(opty, estimationmode));

  // Add the heading and combine the message array into a string
  const blueChip = isBlueChip(pairs[0]);
  addHeading(messages, blueChip, estimationmode);
  const description = messages.join("\n\n");

  // Build the API embedding
  return {
    title: `DLMM Opportunities for ${
      pairs[0].pairName
    }\nLast updated <t:${Math.round(DLMM_OPPORTUNITY_DATA.updated)}:R>`,
    description,
    color: 3329330,
  };
}

function sendPairOpportunities(interaction: ChatInputCommandInteraction) {
  if (DLMM_OPPORTUNITY_DATA.data.length == 0) {
    return REFRESHING_MESSAGE;
  }

  const pairName = interaction.options.get("pairname");
  if (!pairName) {
    return interaction.reply("pairname parameter required");
  }

  const estimationmode = getEstimationMode(interaction);

  if (estimationmode == "") {
    return;
  }
  const embeds = [
    createPairEmbedding(pairName.value as string, estimationmode),
  ];
  interaction.reply({
    embeds,
  });
}

function createTokenEmbedding(
  token: string,
  estimationmode: "min" | "max"
): APIEmbed {
  token = token.trim();
  const pairs = DLMM_OPPORTUNITY_DATA.data.filter(
    (opty) =>
      opty.base.symbol.toLowerCase() == token.toLowerCase() ||
      opty.quote.symbol.toLowerCase() == token.toLowerCase() ||
      opty.base.address == token ||
      opty.quote.address == token
  );

  if (pairs.length == 0) {
    return {
      title: "No Pairs Found",
      description: `Could not find any pairs with the token ${token}`,
      color: 3329330,
    };
  }

  const messages = pairs
    // Trim down to limit the message size
    .slice(0, 10)
    // Generate the messages
    .map((opty) => singleOpportunityMessage(opty, estimationmode));

  // Add the heading and combine the message array into a string
  const blueChip = isBlueChip(pairs[0]);
  addHeading(messages, blueChip, estimationmode);
  const description = messages.join("\n\n");

  // Build the API embedding
  return {
    title: `DLMM Opportunities for ${token.toUpperCase()}\nLast updated <t:${Math.round(
      DLMM_OPPORTUNITY_DATA.updated
    )}:R>`,
    description,
    color: 3329330,
  };
}

function sendTokenOpportunities(interaction: ChatInputCommandInteraction) {
  if (DLMM_OPPORTUNITY_DATA.data.length == 0) {
    return REFRESHING_MESSAGE;
  }

  const token = interaction.options.get("token");
  if (!token) {
    return interaction.reply("token parameter required");
  }
  const estimationmode = getEstimationMode(interaction);
  if (estimationmode == "") {
    return;
  }
  const embeds = [createTokenEmbedding(token.value as string, estimationmode)];
  interaction.reply({
    embeds,
  });
}

function singleAllOpportunityMessage(
  opty: AllSolanaOpportunitesEnriched
): string {
  return `**${opty.symbol}**${
    opty.address != opty.symbol ? ` (${opty.address})` : ""
  }\n⏱ <t:${Math.round(opty.updated / 1000)}:R> 💰 ${opty.volume.toLocaleString(
    "en-US",
    {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }
  )} 📈 ${opty.volumeToTvl}${
    !opty.strict
      ? ` [✅ RugCheck](https://rugcheck.xyz/tokens/${opty.address})`
      : ""
  }\n`;
}

function createAllOpportunityEmbed(optyType: string): APIEmbed {
  const opportunities = SOLANA_OPPORTUNITY_DATA
    // Filter the opportunities according to type
    .filter((opty) => {
      switch (optyType) {
        case "bluechip":
          return opty.strict && BLUE_CHIPS.includes(opty.symbol.toLowerCase());
        case "strict":
          return opty.strict;
        case "degen":
          return !opty.strict;
      }
    })
    // Limit to the top results
    .slice(0, 10);

  const refreshTime = Math.round(
    DLMM_OPPORTUNITY_DATA.updated + DLMM_REFRESH_MS / 1000
  );

  if (opportunities.length == 0) {
    return {
      title: `No results`,
      color: 3329330,
      description: `No results for ${optyType} tokens across all Solana protocols for the past 2 hours\n\nTo get the latest data available, [update the Dune table](https://dune.com/queries/${DUNE_QUERY_ID}) and try again <t:${refreshTime}:R>`,
    };
  }

  // Build the messages
  const messages = opportunities.map((opty) =>
    singleAllOpportunityMessage(opty)
  );

  messages.unshift(
    `**Symbol** (address)\n⏱Last Updated\n💰 Volume\n📈 Volume / TVL Ratio\n${
      optyType == "degen" ? " ✅ Rugcheck\n" : ""
    }`
  );

  let description = messages.join("\n");

  // If the most recent results are over an hour old, add the link to the report to the description
  const mostRecentUpdate = opportunities
    .map((opty) => opty.updated)
    .reduce((prior, current) => (current < prior ? prior : current));
  if (new Date().getTime() - mostRecentUpdate > 1000 * 60 * 60) {
    description += `\n\nTo get the latest data available, [update the Dune table](https://dune.com/queries/${DUNE_QUERY_ID}) and try again <t:${refreshTime}:R>`;
  }

  const optyTypeTitle =
    optyType == "bluechip"
      ? "Blue Chip"
      : optyType == "strict"
      ? "Strict List"
      : "Non-Strict List";

  return {
    title: `Top ${
      messages.length - 1
    } Highest Turnover ${optyTypeTitle} Tokens Across All Solana Protocols for the Past 2 Hours`,
    color: 3329330,
    description,
  };
}

function sendAllOpportunities(interaction: ChatInputCommandInteraction) {
  if (DLMM_OPPORTUNITY_DATA.data.length == 0) {
    return REFRESHING_MESSAGE;
  }

  const optyType = String(interaction.options.get("type")!.value)
    .trim()
    .toLowerCase();
  if (!["degen", "strict", "bluechip"].includes(optyType)) {
    return interaction.reply(
      `${optyType} is not a valid type.  Type must be \`degen\`, \`strict\`, or \`bluechip\``
    );
  }

  const embeds = [createAllOpportunityEmbed(optyType)];

  interaction.reply({
    embeds,
  });
}

function invalidTransaction(
  interaction: ChatInputCommandInteraction,
  txid: string
) {
  interaction.editReply({
    embeds: [
      {
        title: "No Position Found",
        description: `No positions found for transaction ${txid}`,
      },
    ],
  });
}

async function sendProfit(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const txid = interaction.options.get("txid")!.value as string;
  try {
    const profit = await getTotalProfitDataFromSignature(
      CONNECTION,
      PARSER,
      txid
    );
    if (!profit) {
      return invalidTransaction(interaction, txid);
    }
    let addedToLeaderboard = false;
    if (
      !profit.currentValueUsd &&
      !interaction.options.get("excludefromleaderboard")?.value
    ) {
      await addPositionProfitData(interaction.user.id, profit);
      addedToLeaderboard = true;
    }
    const depositsUsd = profit.depositsUsd.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const currentValueUsd = profit.currentValueUsd
      ? profit.currentValueUsd.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : false;
    const unclaimedFeesUsd = profit.currentValueUsd
      ? profit.unclaimedFeesUsd.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : false;
    const claimedFeesUsd = profit.claimedFeesUsd.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const withdrawalsUsd = profit.withdrawalsUsd.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const profitUsd = profit.profitUsd.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const profitPercent = profit.profitPercent.toLocaleString("en-US", {
      style: "percent",
      maximumFractionDigits: 2,
    });
    interaction.editReply({
      embeds: [
        {
          title: `Position Profit`,
          description: `**Position Address**: [${
            profit.positionAddress
          }](https://solscan.io/account/${
            profit.positionAddress
          })\n\n**Deposits**: ${depositsUsd}\n\n**Withdrawals**: ${withdrawalsUsd}\n**Claimed Fees**: ${claimedFeesUsd}\n${
            currentValueUsd
              ? `**Current Position Value**: ${currentValueUsd}\n**Unclaimed Fees**: ${unclaimedFeesUsd}\n`
              : ""
          }\n**Profit: ${profitUsd}\nProfit Percent: ${profitPercent}**\n\n${
            addedToLeaderboard
              ? "Your transaction was added to the leaderboard!  Use the `/leaderboard` command to see if your position ranks at the top."
              : interaction.options.get("excludefromleaderboard")?.value == true
              ? "Your position was not added to the leaderboard"
              : "Position is still open, cannot be added to the leaderboard"
          }`,
          color: 3329330,
        },
      ],
    });
  } catch (err) {
    invalidTransaction(interaction, txid);
  }
}

async function getUsers(userIds: string[]): Promise<Map<string, User>> {
  const uniqueIds = Array.from(new Set(userIds));
  const users = await Promise.all(
    uniqueIds.map((id) => DISCORD_CLIENT.users.fetch(id))
  );
  const userMap = new Map<string, User>();
  users.forEach((user) => userMap.set(user.id, user));
  return userMap;
}

async function sendLeaderboard(interaction: ChatInputCommandInteraction) {
  const leaderboardData = leaderboardQuery.all() as LeaderboardData[];
  const top10Positions = leaderboardData.slice(0, 10);
  const users = await getUsers(
    top10Positions.map((position) => position.user_id)
  );
  const top10 = top10Positions.map(
    (leader, rank) =>
      `**${rank + 1}**: ${users.get(leader.user_id)?.displayName} [${
        leader.pair_name
      }](https://app.meteora.ag/dlmm/${
        leader.pair_address
      }) Total Deposits: ${leader.deposits.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} Profit: ${leader.profit.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} Profit %: ${leader.profitPercent.toLocaleString("en-US", {
        style: "percent",
        maximumFractionDigits: 2,
      })}`
  );
  interaction.reply({
    embeds: [
      {
        title: "Position Profit Leaderboard",
        description: top10.join("\n"),
        color: 3329330,
      },
    ],
  });
}

// Map & helper function for command registration
const COMMANDS = new Map<string, MeteoraBotCommand>();
async function registerCommand(meteoraBotCommand: MeteoraBotCommand) {
  const command = await DISCORD_CLIENT.application!.commands.create(
    meteoraBotCommand.commandData
  );
  const existingCommand = COMMANDS.get(command.name);
  if (!existingCommand) {
    COMMANDS.set(command.name, meteoraBotCommand);
  }
}

async function registerCommands() {
  // Reset guild commands to remove dupes
  DISCORD_CLIENT.guilds.cache.forEach(async (guild) => {
    await guild.commands.set([]);
  });

  // Register all the commands
  await registerCommand({
    commandData: {
      name: "help",
      description: "Get a list of all commands supported by the bot",
    },
    fn: (interaction) => sendHelp(interaction),
    helpText: "Display this info again",
  });
  await registerCommand({
    commandData: {
      name: "degen",
      description:
        "Get a list of DLMM opportunities for tokens not on the strict list",
      options: [
        {
          name: "minliquidity",
          description: "The minimum amount of liquidity.",
          type: ApplicationCommandOptionType.Number,
          required: false,
        },
        {
          name: "estimationmode",
          description:
            "Valid values are min or max.  Default is `min` for more conservative estimates.",
          type: ApplicationCommandOptionType.String,
          required: false,
        },
        {
          name: "minfdv",
          description: "The minimum fully diluted value.  Default is `0`.",
          type: ApplicationCommandOptionType.Number,
          required: false,
        },
        {
          name: "uptrendonly",
          description: "Only display pairs with up-trending volume.",
          type: ApplicationCommandOptionType.Boolean,
          required: false,
        },
      ],
    },
    fn: (interaction) => sendOpportunities(interaction, false),
    helpText:
      "Get a list of DLMM opportunities for tokens not on the strict list.\n- *minliquidity*: the minimum liquidity, default is 600.\n- *estimationmode*: Whether to use the min or max estimated 24H fees.  Default is `min`.\n- *minfdv*: The minimum fully diluted value.  Default is `0`.\n- *uptrendonly*: Only show pairs with an up-trending volume. Default is to display all pairs regardless of volume trend.",
    parameters: ["minliquity", "estimationmode", "minfdv", "uptrendonly"],
  });
  await registerCommand({
    commandData: {
      name: "strict",
      description:
        "Get a list of DLMM opportunities for tokens on the strict list",
      options: [
        {
          name: "minliquidity",
          description: "The minimum amount of liquidity.",
          type: ApplicationCommandOptionType.Number,
          required: false,
        },
        {
          name: "estimationmode",
          description:
            "Valid values are min or max.  Default is `min` for more conservative estimates.",
          type: ApplicationCommandOptionType.String,
          required: false,
        },
        {
          name: "minfdv",
          description: "The minimum fully diluted value.  Default is `0`.",
          type: ApplicationCommandOptionType.Number,
          required: false,
        },
        {
          name: "uptrendonly",
          description: "Only display pairs with up-trending volume.",
          type: ApplicationCommandOptionType.Boolean,
          required: false,
        },
      ],
    },
    fn: (interaction) => sendOpportunities(interaction, true),
    helpText:
      "Get a list of DLMM opportunities for tokens on the strict list.\n- *minliquidity*: the minimum liquidity, default is 600.\n- *estimationmode*: Whether to use the min or max estimated 24H fees.  Default is `min`.\n- *minfdv*: The minimum fully diluted value.  Default is `0`.\n- *uptrendonly*: Only show pairs with an up-trending volume. Default is to display all pairs regardless of volume trend.",
    parameters: ["minliquity", "estimationmode", "minfdv", "uptrendonly"],
  });
  await registerCommand({
    commandData: {
      name: "bluechip",
      description: 'Get a list of DLMM opportunities for "blue chip" tokens',
      options: [
        {
          name: "minliquidity",
          description: "The minimum amount of liquidity.",
          type: ApplicationCommandOptionType.Number,
          required: false,
        },
        {
          name: "estimationmode",
          description:
            "Valid values are min or max.  Default is `min` for more conservative estimates.",
          type: ApplicationCommandOptionType.String,
          required: false,
        },
        {
          name: "minfdv",
          description: "The minimum fully diluted value.  Default is `0`.",
          type: ApplicationCommandOptionType.Number,
          required: false,
        },
        {
          name: "uptrendonly",
          description: "Only display pairs with up-trending volume.",
          type: ApplicationCommandOptionType.Boolean,
          required: false,
        },
      ],
    },
    fn: (interaction) => sendOpportunities(interaction, true, true),
    helpText:
      'Get a list of DLMM opportunities for "blue chip" tokens.\n- *minliquidity*: the minimum liquidity, default is 600.\n- *estimationmode*: Whether to use the min or max estimated 24H fees.  Default is `min`.\n- *minfdv*: The minimum fully diluted value.  Default is `0`.\n- *uptrendonly*: Only show pairs with an up-trending volume. Default is to display all pairs regardless of volume trend.',
    parameters: ["minliquity", "estimationmode", "minfdv", "uptrendonly"],
  });
  await registerCommand({
    commandData: {
      name: "pair",
      description: "Get a list of DLMM opportunities for a specific pair",
      options: [
        {
          name: "pairname",
          description:
            "The name of the pair for which you want opportunities.  Use the format TOKEN1-TOKEN2",
          type: ApplicationCommandOptionType.String,
          required: true,
        },
        {
          name: "estimationmode",
          description:
            "Valid values are min or max.  Default is `min` for more conservative estimates.",
          type: ApplicationCommandOptionType.String,
          required: false,
        },
      ],
    },
    fn: (interaction) => sendPairOpportunities(interaction),
    helpText:
      "Get a list of DLMM opportunities for a specific pair.\n- *pairname*: The pair for the markets you want to see.  Should be in the format TOKEN1-TOKEN2.\n- *estimationmode*: Whether to use the min or max estimated 24H fees.",
    parameters: ["pairname", "estimationmode"],
  });
  await registerCommand({
    commandData: {
      name: "token",
      description: "Get a list of DLMM opportunities for a specific token",
      options: [
        {
          name: "token",
          description:
            "The symbol or address of the pair for which you want opportunities.",
          type: ApplicationCommandOptionType.String,
          required: true,
        },
        {
          name: "estimationmode",
          description:
            "Valid values are min or max.  Default is `min` for more conservative estimates.",
          type: ApplicationCommandOptionType.String,
          required: false,
        },
      ],
    },
    fn: (interaction) => sendTokenOpportunities(interaction),
    helpText:
      "Get a list of DLMM opportunities for a specific token.\n- *token*: The token for pairs you want to see.\n- *estimationmode*: Whether to use the min or max estimated 24H fees.  Default is `min`.",
    parameters: ["token", "estimationmode"],
  });
  await registerCommand({
    commandData: {
      name: "all",
      description:
        "Get a list of all market making opportunities across all of Solana",
      options: [
        {
          name: "type",
          description: "Enter one of the following: degen, strict, bluechip",
          type: ApplicationCommandOptionType.String,
          required: true,
        },
      ],
    },
    fn: (interaction) => sendAllOpportunities(interaction),
    helpText:
      "Get a list of all market making opportunities across all of Solana.  type must be degen, strict, or bluechip",
    parameters: ["type"],
  });
  await registerCommand({
    commandData: {
      name: "profit",
      description: "Get the USD profit for a position",
      options: [
        {
          name: "txid",
          description:
            "The transaction ID to look up.  Can be any transaction associated with a position.",
          type: ApplicationCommandOptionType.String,
          required: true,
        },
        {
          name: "excludefromleaderboard",
          description:
            "Exclude the position from the leaderboard, if the position is closed.",
          type: ApplicationCommandOptionType.Boolean,
          required: false,
        },
      ],
    },
    fn: (interaction) => sendProfit(interaction),
    helpText:
      "Get the profitability of a DLMM position.  To exclude the position from the leaderboard, set the excludefromleaderboard flag to `True`.",
    parameters: ["txid", "excludefromleaderboard"],
  });
  await registerCommand({
    commandData: {
      name: "leaderboard",
      description: "View the profit leaderboard",
    },
    fn: (interaction) => sendLeaderboard(interaction),
    helpText: "View the profit leaderboard.",
  });

  // Set up the command handler
  DISCORD_CLIENT.on("interactionCreate", async (interaction: Interaction) => {
    if (interaction instanceof ChatInputCommandInteraction) {
      const command = COMMANDS.get(interaction.commandName);
      DISCORD_BOT_STATS.interactions++;
      console.log(
        `${new Date().toLocaleTimeString()}: Received ${
          interaction.command?.name
        } request from ${interaction.user.displayName} in ${
          interaction.guild?.name
        }, total interactions: ${DISCORD_BOT_STATS.interactions}`
      );
      command?.fn(interaction);
    }
  });
}

// Initialize everything
DISCORD_CLIENT.once("ready", async () => {
  console.log(`${new Date().toLocaleTimeString()}: Bot is ready.`);
  registerCommands();
  // Run the first refresh
  refreshDlmmOpportunities();
  // Set up the periodic refresh
  setInterval(() => {
    refreshDlmmOpportunities();
  }, DLMM_REFRESH_MS);

  // Do the same for Dune
  if (!process.env.DEBUG) {
    refreshAll();
    setInterval(() => {
      refreshAll();
    }, DUNE_REFRESH_MS);
  }
});

// Login
DISCORD_CLIENT.login(process.env.DISCORD_BOT_TOKEN);
