# Meteora Discord Bot

## Overview

This bot is based on [@GeekLad](https://x.com/GeekLad)'s [Meteora DLMM Market
Making Opportunities Google Sheet](https://docs.google.com/spreadsheets/d/1uMj43pCdVwhDKEswCTbe47LfbmI0CRlmFisDtWaFFyc) and his [Solana DEX Volume to TVL
Report on Dune](https://dune.com/geeklad/solana-dex-volume-to-tvl). It
provides users with useful data on potential market making opportunities on
Meteora DLMMs.

## Use on the Meteora Discord Server

The easiest way to use the bot is to simply join the join the
[🤖 ｜ dlmm-opps-bot](https://discord.com/channels/841152225564950528/1240680906923049080)
channel on the [Meteora Discord Server](https://discord.com/invite/meteora).

## Bot Commands

- **`/help`**: Display this info again
- **`/degen` _`minliquidity`_ _`estimationmode`_ _`minfdv`_ _`uptrendonly`_**:
  Get a list of DLMM opportunities for tokens not on the strict list.
  - Optional _minliquidity_ parameter for the minimum liquidity. Default is
    `600`.
  - Optional _estimationmode_ indicates whether to use the `min` or `max`
    estimated fees. Default is `min`.
  - Optional _minfdv_ parameter for the minimum fully diluted value. Default is
    `0`.
  - Optional _uptrendonly_ parameter to only display pairs with up trending
    volume. Default is `False` (i.e. display all pairs regardless of trend).
- **`/strict` _`minliquidity`_ _`estimationmode`_ _`minfdv`_ _`uptrendonly`_**:
  Get a list of DLMM opportunities for tokens on the strict list.
  - Optional _minliquidity_ parameter for the minimum liquidity. Default is
    `600`.
  - Optional _estimationmode_ indicates whether to use the `min` or `max`
    estimated fees. Default is `min`.
  - Optional _minfdv_ parameter for the minimum fully diluted value. Default is
    `0`.
  - Optional _uptrendonly_ parameter to only display pairs with up trending
    volume. Default is `False` (i.e. display all pairs regardless of trend).
- **`/bluechip` _`minliquidity`_ _`estimationmode`_ _`minfdv`_ _`uptrendonly`_**:
  Get a list of DLMM opportunities for "blue chip" tokens.
  - Optional _minliquidity_ parameter for the minimum liquidity. Default is
    `600`.
  - Optional _estimationmode_ indicates whether to use the `min` or `max`
    estimated fees. Default is `min`.
  - Optional _minfdv_ parameter for the minimum fully diluted value. Default is
    `0`.
  - Optional _uptrendonly_ parameter to only display pairs with up trending
    volume. Default is `False` (i.e. display all pairs regardless of trend).
- **`/pair` _`pairname`_ _`estimationmode`_**: Get a list of DLMM opportunities
  for a specific pair.
  - Required _pairname_ parameter should be in the format `TOKEN1-TOKEN2`.
  - Optional _estimationmode_ indicates whether to use the `min` or `max`
    estimated fees. Default is `min`.
- **`/token` _`token`_ _`estimationmode`_**: Get a list of DLMM opportunities
  for a specific token.
  - Required _token_ parameter
  - Optional _estimationmode_ indicates whether to use the `min` or `max`
    estimated fees. Default is `min`.
- **`/all` _`type`_**: Get a list of all market making opportunities across all
  of Solana.
  - Required _type_ parameter must be `degen`, `strict`, or `bluechip`.
- **`/profit` _`txid`_**: Get the profit for a Meteora DLMM position.
  - Required _txid_ can be any transaction associated with the position (add,
    remove, fee claim, etc.).

## Installing the Bot on Your Own Discord Server

If you want to install the bot on your own Discord server, go to this OAuth URL,
and follow the steps to add it to your server:

https://discord.com/oauth2/authorize?client_id=1239340511765074061

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
  - `DLMM_REFRESH_MINUTES`: The number of minutes to wait between refreshes for
    DLMM opportunities (defaults to 15 minutes)
  - `DUNE_REFRESH_MINUTES`: The number of minutes to wait between refreshes for
    all opportunities (defaults to 60 minutes)
  - `ENABLE_DUNE_REFRESH`: Flag to enable the re-running of the Dune query.
    This will cost API credits.
  - `DEBUG`: Flag to disable Dune, to avoid spending credits while testing out
    other stuff.
- Run the bot with the pm2 launch script: `./pm2-start.sh`
- Stop the bot with the pm2 stop script: `./pm2-stop.sh`
- You can use pm2 commands with `npx pm2` (`npx pm2 status`, `npx pm2 log`, etc.)

### Compiling Google Apps Script for Google Sheets

To compile the app to use in Google Sheets, run `./build-gs.sh`. This will
output the `google-app-script.gs` file, which will provide a valid Google App
Script that can be used in Google Sheets.

## Credits

[@MeteoraAG](https://x.com/MeteoraAG) for creating Meteora

[@GeekLad](https://x.com/GeekLad) for creating the opportunity Google Sheet
and this bot

[@Foxtrot](https://x.com/foxtroteth) for looking at Geeklad's Google Apps
script, and modifying it to create a Discord bot and inspiring GeekLad to
create is own and open sourcing it.

[@benchow.sol](https://twitter.com/hellochow) for suggesting adding the
trend indicator
