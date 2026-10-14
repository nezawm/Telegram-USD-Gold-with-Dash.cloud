# Telegram USD & Gold Price Bot — Cloudflare Workers

A Telegram bot built with a Cloudflare Worker. It fetches USD and 18-karat gold prices from Navasan and can send scheduled price updates, calculate custom amounts, and forward custom-bot requests to the administrator.

## Features

- **Current prices:** get the latest USD and 18k gold prices using `/price` or the menu.
- **Custom amount calculator:** send a message in one of these formats:
  - `10 دلار` — calculates the total price of 10 US dollars in toman.
  - `3 گرم` — calculates the total price of 3 grams of 18-karat gold in toman.
  - Persian numerals are supported too, for example `۱۰ دلار` and `۳ گرم`.
- **Scheduled updates:** a Cron Trigger can send prices every four hours to users who have started the bot. Users can stop or resume scheduled messages with `/stop` and `/start`.
- **Telegram command menu:** `/start`, `/stop`, and `/price`.
- **Custom-bot requests:** the menu lets a user describe a bot they want; the request is forwarded to the administrator's Telegram chat.
- **Persian formatting:** price messages include Persian numerals and Tehran date/time.

## Commands

| Command | What it does |
| --- | --- |
| `/start` | Starts or resumes the bot and displays the main menu. |
| `/price` | Fetches and sends the latest USD and 18k gold prices. |
| `/stop` | Stops scheduled price messages for that chat. |

To calculate a custom amount, send only the amount and unit, for example `10 دلار` or `3 گرم`.

## How it works

- `worker.js` exports two entry points:
  - `fetch()` handles Telegram webhook updates, commands, button presses, and custom amount messages.
  - `scheduled()` sends scheduled price updates when the Cron Trigger runs.
- The Worker requests current prices from the Navasan API. It uses `usd_sell` (or `usd` as a fallback) for USD and `18ayar` for 18-karat gold.
- The `BOT_STATE` KV namespace stores subscriber status and short-lived conversation state.
- Telegram bot token, Navasan API key, and administrator chat ID are configured in Cloudflare settings, not hard-coded in this repository.

## Setup

### 1. Create a Telegram bot and collect credentials

1. Open [@BotFather](https://t.me/BotFather), run `/newbot`, and copy the bot token.
2. Find your numeric Telegram chat ID using a trusted chat-ID bot or your existing setup. This becomes `ADMIN_CHAT_ID`.
3. Obtain an API key from [Navasan](https://navasan.tech/).

### 2. Create and deploy the Cloudflare Worker

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com/).
2. Go to **Workers & Pages** and create a Worker.
3. Paste the contents of `worker.js` into the editor and deploy it.
4. Keep the Worker URL handy; it will be used as the Telegram webhook URL.

### 3. Configure secrets

In **Worker → Settings → Variables and Secrets**, configure these values securely:

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from BotFather |
| `NAVASAN_API_KEY` | Navasan API key |
| `ADMIN_CHAT_ID` | Numeric Telegram chat ID for administrator notifications and custom-bot requests |

Never commit real tokens or API keys to GitHub.

### 4. Bind the KV namespace

1. In Cloudflare, create a KV namespace.
2. Open the Worker settings and add a **KV Namespace** binding.
3. Set the variable name to exactly `BOT_STATE` and select the namespace.

### 5. Configure the scheduled trigger

In **Worker → Settings → Triggers → Cron Triggers**, add:

```text
0 */4 * * *
```

This schedule runs every four hours in UTC. Cloudflare Cron schedules use UTC, so the local time in your region may differ.

### 6. Configure Telegram's webhook

Use your actual Worker URL and bot token in the Telegram Bot API request below:

```text
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=<YOUR_WORKER_URL>
```

Replace both placeholders with your real values. Do not publish a URL containing your real bot token.

### 7. Test the bot

In a private chat with the bot, send:

1. `/start` — confirm the welcome message and menu appear.
2. `/price` — confirm current USD and 18k gold prices are returned.
3. `10 دلار` — confirm the bot returns the USD unit rate and total.
4. `3 گرم` — confirm the bot returns the 18k gold unit rate and total.
5. `/stop` — confirm scheduled updates are disabled for that chat; send `/start` to resume.

## Using the bot in Telegram groups

The custom calculator can reply to messages such as `10 دلار` and `3 گرم` in groups, provided Telegram delivers those messages to the bot.

1. Open [@BotFather](https://t.me/BotFather) and run `/setprivacy`.
2. Select your bot and choose **Disable**.
3. Remove the bot from the group and add it again so the updated privacy setting takes effect.
4. Test with `10 دلار` and `3 گرم`.

Only messages matching the supported amount formats are handled by the custom calculator; ordinary unrecognized messages are ignored. Group administrators should consider whether the bot needs access to all group messages before disabling privacy mode.

## Customization

- **Update frequency:** change the Cron Trigger in Cloudflare.
- **Menu buttons:** edit `mainMenuKeyboard()` in `worker.js`.
- **Price source or fields:** edit `fetchPricesMessage()` and the Navasan response fields used by the custom calculator.
- **Custom calculation formats:** edit the amount matching logic in `handleMessage()`.

## Troubleshooting and security

- If the bot does not respond, check the Worker logs, webhook status, required secrets, and the `BOT_STATE` binding.
- If it does not see ordinary group messages, check BotFather's `/setprivacy` setting and re-add the bot to the group.
- If price fetching fails, verify the Navasan API key and check whether the API is responding.
- If a bot token is exposed, revoke it with BotFather and update the `TELEGRAM_BOT_TOKEN` secret in Cloudflare.
- The scheduled broadcast sends messages to users who have started the bot, except chats that have opted out using `/stop`. Telegram users generally need to start a bot before it can message them privately.

## Project structure

```text
.
└── worker.js
```

This project uses a single Worker source file and does not require a separate build step or `package.json`.
