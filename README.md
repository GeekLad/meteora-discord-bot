# Meteora Discord Bot

## Overview

This bot is based on [@GeekLad](https://x.com/GeekLad)'s [Meteora DLMM Market
Making Opportunities Google Sheet](https://docs.google.com/spreadsheets/d/1uMj43pCdVwhDKEswCTbe47LfbmI0CRlmFisDtWaFFyc) and his [Solana DEX Volume to TVL
Report on Dune](https://dune.com/geeklad/solana-dex-volume-to-tvl). It
provides users with useful data on potential market making opportunities on
Meteora DLMMs.

## Installing the Bot on a Discord Server

To install the bot, just go to this OAuth URL, and follow the steps to add it
to a Discord server:

https://discord.com/oauth2/authorize?client_id=1239340511765074061

## Bot Commands

- **`/help`**: Display this info again
- **`/degen`**: Get a list of DLMM opportunities for tokens not on the strict list
- **`/strict`**: Get a list of DLMM opportunities for tokens on the strict list
- **`/bluechip`**: Get a list of DLMM opportunities for "blue chip" tokens
- **`/pair`_`pairname`_**: Get a list of DLMM opportunities for a specific pair. Parameter pairname should be in the format `TOKEN1-TOKEN2`
- **`/token`_`token`_**: Get a list of DLMM opportunities for a specific token.
- **`/all`_`type`_**: Get a list of all market making opportunities across all of Solana. type must be degen, strict, or bluechip

## Technical Info

The bot is written in TypeScript, and utilizes [Bun](https://bun.sh). Bun
removes all friction for creating a TypeScript project. It also allows `async`
calls to be made in the entrypoint script, which is great for lazy people like
GeekLad.

### Meteora DLMM Opportunties

The bot uses the [Meteora API](https://dlmm-api.meteora.ag/swagger-ui) to obtain
DLMM markets, as well as the
[DEX Screener API](https://docs.dexscreener.com/api/reference).
For each market it:

- Obtains the volume for the past 5 minutes, 1 hour, 6 hours, and 24 hours
- Based on each of those intervals, it projects the 24-hour fees / TVL
- Determines the minimum 24-hour fees / TVL projection (i.e. the most
  conservative)
- Determines if it has an up-trend by looking for increasing projected fees
  between different time steps
- Displays the top projected 24-hour fee / TVL results for markets in an
  up-trend that have at least $1,000 in liquidity

### Solana Opportunities

The bot uses the Dune API to obtain data from a
[Dune query to obtain volume to tvl ratios](https://dune.com/queries/3734698/6281578)
across all DEXes/AMMs on Solana. Users can filter results down according to
their investment preferences.

### Running the Bot

- [Install Bun](https://bun.sh)
- Create a `.env` with the following environment variables:
  - `DISCORD_BOT_TOKEN`: Your Discord bot's token
  - `DUNE_API_KEY`: Your [Dune API key](https://dune.com/settings/api)
  - `DLMM_REFRESH_MINUTES`: The number of minutes to wait between refreshes for DLMM opportunities (defaults to 15 minutes)
  - `DUNE_REFRESH_MINUTES`: The number of minutes to wait between refreshes for all opportunities (defaults to 60 minutes)
  - `ENABLE_DUNE_REFRESH`: Flag to enable the re-running of the Dune query. This will cost API credits.
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
