# Meteora Discord Bot

## Overview

This bot is based on [@GeekLad](https://x.com/GeekLad)'s [Meteora DLMM Market
Making Opportunities Google Sheet](https://docs.google.com/spreadsheets/d/1uMj43pCdVwhDKEswCTbe47LfbmI0CRlmFisDtWaFFyc). It uses the
[Meteora API](https://dlmm-api.meteora.ag/swagger-ui) to obtain DLMM markets,
as well as the [DEX Screener API](https://docs.dexscreener.com/api/reference).
For each market it:

- Obtains the volume for the past 5 minutes, 1 hour, 6 hours, and 24 hours
- Based on each of those intervals, it projects the 24-hour fees / TVL
- Determines the minimum 24-hour fees / TVL projection (i.e. the most
  conservative)
- Determines if it has an up-trend by looking for increasing projected fees
  between different time steps
- Displays the top projected 24-hour fee / TVL results for markets in an
  up-trend that have at least $1,000 in liquidity

The bot is written in TypeScript, and utilizes [Bun](https://bun.sh). Bun
removes all friction for creating a TypeScript project. It also allows `async`
calls to be made in the entrypoint script, which is great for lazy people like
GeekLad.

## Running the Bot

- [Install Bun](https://bun.sh)
- Create a `.env` with the following environment variables:
  - `DISCORD_BOT_TOKEN`: Your Discord bot's token
- Run `bun run index.ts`
- Use the bot commands `/strict` and `/degen`

## Credits

[@MeteoraAG](https://x.com/MeteoraAG) for creating Meteora

[@GeekLad](https://x.com/GeekLad) for creating the opportunity Google Sheet
and this bot

[@Foxtrot](https://x.com/foxtroteth) for looking at Geeklad's Google Apps
script, and modifying it to create a Discord bot and inspiring GeekLad to
create is own and open sourcing it.

[@benchow.sol](https://twitter.com/hellochow) for suggesting adding the
trend indicator
