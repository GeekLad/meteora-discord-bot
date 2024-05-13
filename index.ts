import {
  ChannelType,
  Client,
  IntentsBitField,
  MessageFlags,
  type APIEmbed,
} from "discord.js";
import { getOpportunities, type OpportunityData } from "./opportunity-finder";
import type { DexScreenerToken } from "./dex-screener";
import { RUG_CHECK_EXCEPTIONS } from "./config";

// Verify the required environment variables
const environmentErrors: string[] = [];

if (!process.env.DISCORD_BOT_TOKEN) {
  environmentErrors.push("DISCORD_BOT_TOKEN environment variable missing.");
}
if (!process.env.OPPORTUNITY_CHANNELS) {
  environmentErrors.push("OPPORTUNITY_CHANNELS environment variable missing.");
}
if (environmentErrors.length > 0) {
  throw new Error(
    "Unable to start bot, environment not configured properly.\n" +
      environmentErrors.join("\n")
  );
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

function createOpportunityEmbedding(
  opportunities: OpportunityData[]
): APIEmbed {
  const messages = opportunities
    // Filter trending
    .filter((opty) => (opty.trend = "Up"))
    // Trim down to limit the message size
    .slice(0, 15)
    // Generate the messages
    .map((opty) => singleOpportunityMessage(opty));

  messages.unshift(
    "**Pair Name**\n:broom: Estimated 24H Fees / TVL\n:dollar: Market TVL\n:red_square: Bin Step\n:bookmark: Base Fee\n:white_check_mark: Rug Check"
  );

  // Combine the message array into a string
  const description = messages.join("\n\n");

  // Build the API embedding
  return {
    title: `Top ${messages.length - 1} DLMM Opportunities`,
    description,
    color: 3329330,
  };
}

async function sendChannelOpportunities(
  client: Client,
  channelNames: string[]
) {
  const opportunities = await getOpportunities();
  const embeds = [createOpportunityEmbedding(opportunities)];

  client.channels.cache.forEach(async (channel) => {
    if (
      channel.type == ChannelType.GuildText &&
      channelNames.includes(channel.name)
    ) {
      try {
        channel.send({
          embeds,
        });
      } catch (err) {
        console.error(err);
      }
    }
  });
}

// Get the broadcast channels
const OPPORTUNITY_CHANNELS = process.env.OPPORTUNITY_CHANNELS!.split(/\s*,\s*/);

// Instantiate the Discord client
const client = new Client({
  intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMessages],
});

// Simple message when it's connected
client.once("ready", async () => {
  console.log("Bot is online!");
  // Send opportunities when first connecting
  sendChannelOpportunities(client, OPPORTUNITY_CHANNELS);

  // Send opportunities every hour
  setInterval(
    () => sendChannelOpportunities(client, OPPORTUNITY_CHANNELS),
    1000 * 60 * 60
  );
});

client.login(process.env.DISCORD_BOT_TOKEN);
