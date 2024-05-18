import {
  ApplicationCommandOptionType,
  ChatInputCommandInteraction,
  Client,
  Guild,
  IntentsBitField,
  type APIEmbed,
  type ApplicationCommandDataResolvable,
  type Interaction,
} from "discord.js";
import { getOpportunities, type OpportunityData } from "./opportunity-finder";
import type { DexScreenerToken } from "./dex-screener";
import { BLUE_CHIPS, REFRESHING_MESSAGE } from "./config";
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

async function refreshOpportunities() {
  const tokenMap = await getJupiterTokenList();
  try {
    const data = await getOpportunities(tokenMap);
    OPPORTUNITY_DATA = {
      updated: new Date().getTime() / 1000,
      data,
    };
    return OPPORTUNITY_DATA;
  } catch (err) {
    console.error(err);
    console.error("Retrying refresh in 30 seconds...");
    setInterval(refreshOpportunities, 30 * 1000);
  }
}

function rugCheck(token: DexScreenerToken): string {
  if (!BLUE_CHIPS.includes(token.symbol.toLowerCase())) {
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
  const message = `**[${pairName}](https://app.meteora.ag/dlmm/${pairAddress})** :printer: ${feestoTvl} :money_bag: ${liquidity} :ladder: ${binStep} :dollar: ${baseFee}`;
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

function addHeading(messages: string[], blueChip: boolean) {
  messages.unshift(
    `**Pair Name**\n:printer: Estimated Minimum 24H Fees / TVL\n:money_bag: Market TVL\n:ladder: Bin Step\n:dollar: Base Fee${
      !blueChip ? "\n:white_check_mark: Rug Check" : ""
    }`
  );
}

function createOpportunityEmbedding(
  strict = false,
  blueChip = false
): APIEmbed {
  if (OPPORTUNITY_DATA.data.length == 0) {
    return REFRESHING_MESSAGE;
  }

  const messages = OPPORTUNITY_DATA.data
    // Filter trending
    .filter(
      (opty) =>
        opty.trend == "Up" &&
        ((!strict && isDegen(opty)) ||
          (strict && !blueChip && isStrict(opty)) ||
          (strict && blueChip && isBlueChip(opty)))
    )
    // Trim down to limit the message size
    .slice(0, 10)
    // Generate the messages
    .map((opty) => singleOpportunityMessage(opty));

  // Add the heading and combine the message array into a string
  addHeading(messages, blueChip);
  const description = messages.join("\n\n");

  // Build the API embedding
  return {
    title: `Top ${messages.length - 1} ${
      !strict ? "Non-Strict List" : !blueChip ? "Strict List" : "Blue Chip"
    } DLMM Opportunities\nLast updated <t:${Math.round(
      OPPORTUNITY_DATA.updated
    )}:R>`,
    description,
    color: 3329330,
  };
}

async function sendOpportunities(
  interaction: ChatInputCommandInteraction,
  strict: boolean,
  blueChip = false
) {
  const embeds = [createOpportunityEmbedding(strict, blueChip)];
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

function createPairEmbedding(pairName: string): APIEmbed {
  const symbols = pairName
    .toLowerCase()
    .trim()
    .split(/[-/\s]/);
  if (symbols.length != 2) {
    return invalidPir(pairName);
  }
  const pairs = OPPORTUNITY_DATA.data.filter(
    (opty) =>
      opty.trend == "Up" &&
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
    .map((opty) => singleOpportunityMessage(opty));

  // Add the heading and combine the message array into a string
  const blueChip = isBlueChip(pairs[0]);
  addHeading(messages, blueChip);
  const description = messages.join("\n\n");

  // Build the API embedding
  return {
    title: `DLMM Opportunities for ${
      pairs[0].pairName
    }\nLast updated <t:${Math.round(OPPORTUNITY_DATA.updated)}:R>`,
    description,
    color: 3329330,
  };
}

function sendPairOpportunities(interaction: ChatInputCommandInteraction) {
  const pairName = interaction.options.get("pairname");
  if (!pairName) {
    return interaction.reply("pairname parameter required");
  }
  const embeds = [createPairEmbedding(pairName.value as string)];
  interaction.reply({
    embeds,
  });
}

function sendHelp(interaction: ChatInputCommandInteraction) {
  interaction.reply(
    "**Meteora Bot Commands**\n\
    **/degen**: Lists DLMM opportunities for non-strict list tokens\n\
    **/strict**: Lists DLMM opportunities for strict list tokens\n\
    **/bluechip**: Lists DLMM opportunities for total high-TVL tokens\n\
    **/pair** *pairname*:  Lists DLMM opportunities for a specific token pair\n\
    **/help**: See this again"
  );
}

// Map & helper function for command registration
const COMMANDS = new Map<
  string,
  (interaction: ChatInputCommandInteraction) => any | Promise<any>
>();
async function registerCommand(
  guild: Guild,
  commandData: ApplicationCommandDataResolvable,
  fn: (interaction: ChatInputCommandInteraction) => any | Promise<any>
) {
  const command = await guild.commands.create(commandData);
  COMMANDS.set(command.name, fn);
}

function registerCommands() {
  // Reset app commands to remove dupes
  const app = CLIENT.application!;
  app.commands.set([]);

  // Set up commands for guilds
  CLIENT.guilds.cache.forEach(async (guild) => {
    // Reset guild commands
    await guild.commands.set([]);

    // Register all the commands
    registerCommand(
      guild,
      {
        name: "help",
        description: "Get a list of all commands supported by the bot",
      },
      (interaction) => sendHelp(interaction)
    );
    registerCommand(
      guild,
      {
        name: "degen",
        description: "Get a list of top non-strict opportunities",
      },
      (interaction) => sendOpportunities(interaction, false)
    );
    registerCommand(
      guild,
      {
        name: "strict",
        description: "Get a list of strict opportunities",
      },
      (interaction) => sendOpportunities(interaction, true)
    );
    registerCommand(
      guild,
      {
        name: "bluechip",
        description: "Get a list of blue chip opportunities",
      },
      (interaction) => sendOpportunities(interaction, true, true)
    );
    registerCommand(
      guild,
      {
        name: "pair",
        description: "Get a list of the opportunities for a specific pair",
        options: [
          {
            name: "pairname",
            description:
              "The name of the pair for which you want opportunities.  Use the format TOKEN1-TOKEN2",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      (interaction) => sendPairOpportunities(interaction)
    );
  });

  // Set up the command handler
  CLIENT.on("interactionCreate", async (interaction: Interaction) => {
    if (interaction instanceof ChatInputCommandInteraction) {
      const fn = COMMANDS.get(interaction.commandName);
      fn!(interaction);
    }
  });
}

// Initialize everything
CLIENT.once("ready", async () => {
  console.log("Bot is ready.");
  registerCommands();
  // Run the first refresh
  refreshOpportunities();
  // Set up the periodic refresh
  setInterval(refreshOpportunities, REFRESH_MS);
});

// Login
CLIENT.login(process.env.DISCORD_BOT_TOKEN);
