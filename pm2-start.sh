#!/bin/sh
npx pm2 start --interpreter ~/.bun/bin/bun index.ts --name meteora-discord-bot --exp-backoff-restart-delay 30000