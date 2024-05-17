import {
  ChatInputCommandInteraction,
  Client,
  IntentsBitField,
  MessageContextMenuCommandInteraction,
  UserContextMenuCommandInteraction,
  type APIEmbed,
  type CacheType,
  type Interaction,
} from "discord.js";
import { getOpportunities, type OpportunityData } from "./opportunity-finder";
import type { DexScreenerToken } from "./dex-screener";
import { RUG_CHECK_EXCEPTIONS } from "./config";
import { getJupiterTokenList } from "./jupiter-token-list";

interface DiscordOpportunityData {
  updated: number;
  data: OpportunityData[];
}

// Verify the required environment variables
const environmentErrors: string[] = [];

if (!process.env.DISCORD_BOT_TOKEN) {
  environmentErrors.push("DISCORD_BOT_TOKEN environment variable missing.");
}
if (environmentErrors.length > 0) {
  throw new Error(
    "Unable to start bot, environment not configured properly.\n" +
      environmentErrors.join("\n")
  );
}

// Instantiate the Discord client
const CLIENT = new Client({
  intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMessages],
});

// Set up opportunity data refresh
const REFRESH_MS = process.env.REFRESH_MINUTES
  ? Number(process.env.REFRESH_MINUTES) * 60 * 1000
  : 15 * 60 * 1000;
let OPPORTUNITY_DATA: DiscordOpportunityData = {
  updated: 0,
  data: [],
};
setInterval(refreshOpportunities, REFRESH_MS);

async function refreshOpportunities() {
  const tokenMap = await getJupiterTokenList();
  const data = await getOpportunities(tokenMap);
  OPPORTUNITY_DATA = {
    updated: new Date().getTime() / 1000,
    data,
  };
  return OPPORTUNITY_DATA;
}

function rugCheck(token: DexScreenerToken): string {
  if (!RUG_CHECK_EXCEPTIONS.includes(token.symbol)) {
    return `[${token.symbol}](https://rugcheck.xyz/tokens/${token.address})`;
  }
  return "";
}

function singleOpportunityMessage(opty: OpportunityData): string {
  const pairAddress = opty.pairAddress;
  const pairName = opty.pairName;
  const feestoTvl = opty.feeToTvl.min.toLocaleString("en-US", {
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
  const message = `**[${pairName}](https://app.meteora.ag/dlmm/${pairAddress})** :broom: ${feestoTvl} :dollar: ${liquidity} :red_square: ${binStep} :bookmark: ${baseFee}`;
  const rugChecks = [rugCheck(opty.base), rugCheck(opty.quote)];
  if (rugChecks[0] != "" && rugChecks[1] != "") {
    return message + " :white_check_mark: " + rugChecks.join(", ");
  }
  if (rugChecks[0] != "") {
    return message + " :white_check_mark: " + rugChecks[0];
  }
  if (rugChecks[1] != "") {
    return message + " :white_check_mark: " + rugChecks[1];
  }
  return message;
}

function createOpportunityEmbedding(strict = false): APIEmbed {
  if (OPPORTUNITY_DATA.data.length == 0) {
    return {
      title: "Updating",
      description:
        "Please try again in a minute, data is currently refreshing.",
      color: 3329330,
    };
  }

  const messages = OPPORTUNITY_DATA.data
    // Filter trending
    .filter(
      (opty) =>
        opty.trend == "Up" &&
        ((!strict && !opty.strict) || (strict && opty.strict))
    )
    // Trim down to limit the message size
    .slice(0, 10)
    // Generate the messages
    .map((opty) => singleOpportunityMessage(opty));

  messages.unshift(
    "**Pair Name**\n:broom: Estimated 24H Fees / TVL\n:dollar: Market TVL\n:red_square: Bin Step\n:bookmark: Base Fee\n:white_check_mark: Rug Check"
  );

  // Combine the message array into a string
  const description = messages.join("\n\n");

  // Build the API embedding
  return {
    title: `Top ${messages.length - 1} ${
      !strict ? "Non-" : ""
    }Strict List DLMM Opportunities\nLast updated <t:${Math.round(
      OPPORTUNITY_DATA.updated
    )}:R>`,
    description,
    color: 3329330,
  };
}

async function sendOppoprtunities(
  interaction:
    | ChatInputCommandInteraction<CacheType>
    | MessageContextMenuCommandInteraction<CacheType>
    | UserContextMenuCommandInteraction<CacheType>,
  strict: boolean
) {
  const embeds = [createOpportunityEmbedding(strict)];
  interaction.reply({
    embeds,
  });
}

function registerCommands() {
  const app = CLIENT.application!;

  CLIENT.guilds.cache.forEach(async (guild) => {
    guild.commands.create({
      name: "degen",
      description: "Get a list of top non-strict opportunities",
    });
    guild.commands.create({
      name: "strict",
      description: "Get a list of strict opportunities",
    });
  });

  CLIENT.on("interactionCreate", async (interaction: Interaction) => {
    if (!interaction.isCommand()) return;
    switch (interaction.commandName) {
      case "degen":
        sendOppoprtunities(interaction, false);
        break;
      case "strict":
        sendOppoprtunities(interaction, true);
        break;
    }
  });
}

// Register commands when the bot is ready
CLIENT.once("ready", async () => {
  console.log("Bot is ready.");
  registerCommands();
  refreshOpportunities();
});

CLIENT.login(process.env.DISCORD_BOT_TOKEN);
