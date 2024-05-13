import {
  ChannelType,
  Client,
  IntentsBitField,
  MessageFlags,
  TextChannel,
} from "discord.js";
import { getOpportunities, type OpportunityData } from "./opportunity-finder";

function opportunityMessage(opty: OpportunityData): string {
  const pairAddress = opty.pairAddress;
  const pairName = opty.pairName;
  const liquidity = opty.liquidity;
  const fdv = opty.fdv;
  const binStep = opty.binStep;
  const baseFee = opty.baseFee;
  const vol = opty.volume24h.min;
  const fees = opty.fees24h.min;
  const feestoTvl = opty.feeToTvl.min;

  return `**[${pairName}](https://app.meteora.ag/dlmm/${pairAddress})** :broom: ${feestoTvl} :dollar: ${fees} :pushpin: ${fdv} :bar_chart: ${liquidity} :triangular_ruler: ${vol} :red_square: ${binStep} :bookmark: ${baseFee}`;
}

async function sendChannelOpportunities(channelNames: string[]) {
  const opportunities = await getOpportunities();
  const top5Trending = opportunities
    .filter((opty) => (opty.trend = "Up"))
    .slice(0, 5)
    .map((opty) => opportunityMessage(opty));
  top5Trending.unshift(
    "**Pair Name** :broom: Estimated 24H Fees / TVL :dollar: Estimated 24H Fees :pushpin: FDV :bar_chart: TVL :triangular_ruler: Estimated 24H Volume :red_square: Bin Step :bookmark: Base Fee"
  );

  client.channels.cache.forEach(async (channel) => {
    if (
      channel.type == ChannelType.GuildText &&
      channelNames.includes(channel.name)
    ) {
      try {
        channel.send({
          content: top5Trending.join("\n"),
          flags: MessageFlags.SuppressEmbeds,
        });
      } catch (err) {
        console.error(err);
      }
    }
  });
}

// Instantiate the Discord client
const client = new Client({
  intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMessages],
});

// Simple message when it's connected
client.once("ready", async () => {
  console.log("Bot is online!");
  // Send opportunities when first connecting
  sendChannelOpportunities(["testing"]);

  // Send opportunities every 15 minutes
  setInterval(() => sendChannelOpportunities(["testing"]), 1000 * 60 * 15);
});

client.login(process.env.DISCORD_BOT_TOKEN);
