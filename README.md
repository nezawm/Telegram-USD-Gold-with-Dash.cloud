# Telegram USD & Gold Price Bot (Cloudflare Workers, free forever)

A single free Cloudflare Worker that does two things:

1. **Pushes the USD / 18k gold price automatically every few hours** (via a Cron Trigger) to your own Telegram chat.
2. **Responds instantly to menu buttons** — `/start` shows an inline ("glass") menu with two buttons:
   - 🤖 **ساخت بات شخصی – ۲۹۹,۰۰۰ تومان** — asks the user to describe what they want, then forwards that description plus their Telegram ID to your own chat (the admin), so only you see it.
   - 💱 **آخرین تغییرات دلار و طلا** — sends the latest price on demand.

Unlike a plain cron script, this version can react to button presses immediately, because Cloudflare Workers don't sleep and respond to Telegram's webhook the moment a user interacts with the bot. The whole thing fits comfortably inside Cloudflare's free tier (100,000 requests/day, 5 free cron triggers) with no credit card, no trial period, and no server to maintain.

## How it works

- `worker.js` exports two handlers:
  - `fetch()` — receives Telegram webhook updates (messages and button presses) and reacts immediately.
  - `scheduled()` — runs on the Cron Trigger you configure, and sends the price automatically.
- A Cloudflare **KV namespace** (`BOT_STATE`) remembers, per chat, whether a user is in the middle of typing a description for the custom-bot request. This is the only "state" the bot needs.
- Secrets (bot token, admin chat ID, API key) are stored as **Worker secrets** — encrypted, never visible in the code or in logs.

## Setup

### 1. Get your credentials

- **Telegram bot token**: message `@BotFather`, run `/newbot`, copy the token.
- **Your chat ID** (this becomes `ADMIN_CHAT_ID`, the only place custom-bot requests are shown): message `@userinfobot` and copy the numeric `Id`. Then open a chat with your own bot and press *Start* once.
- **navasan.tech API key**: sign up at navasan.tech and copy your key.

### 2. Create the Worker

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com) → sign up free if you don't have an account.
2. **Workers & Pages → Create → Create Worker**. Give it any name (e.g. `telegram-price-bot`) and deploy the default "Hello World" code first.
3. Click **Edit code**, delete everything, and paste in the contents of `worker.js` from this folder. Click **Deploy**.

### 3. Add the secrets

In the Worker's **Settings → Variables and Secrets**, add three **secret** variables (not plain text):

| Name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the token from BotFather |
| `ADMIN_CHAT_ID` | your numeric chat ID |
| `NAVASAN_API_KEY` | your navasan.tech API key |

### 4. Create the KV namespace

1. In the Cloudflare dashboard, go to **Storage & Databases → KV → Create namespace**. Name it anything, e.g. `bot-state`.
2. Back in your Worker's **Settings → Bindings → Add binding → KV Namespace**. Set the **variable name** to exactly `BOT_STATE` and select the namespace you just created.

### 5. Add the Cron Trigger

In the Worker's **Settings → Triggers → Cron Triggers → Add Cron Trigger**, enter a schedule such as:

```
0 */4 * * *
```

This runs every 4 hours (00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC). Change `4` to however many hours you want between messages.

### 6. Point Telegram at your Worker (webhook)

Your Worker has a public URL like `https://telegram-price-bot.<your-subdomain>.workers.dev`. Visit this URL once in your browser (replace both placeholders) to register it with Telegram:

```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://telegram-price-bot.<your-subdomain>.workers.dev
```

You should see `{"ok":true,"result":true,...}`. That's it — no further action needed.

### 7. Test it

- Send `/start` to your bot in Telegram. You should get the welcome message with your chat ID and the two-button menu.
- Press **💱 آخرین تغییرات دلار و طلا** — you should get the current price immediately.
- Press **🤖 ساخت بات شخصی...** — the message should change to ask what you want the bot for. Reply with any text, and you (as `ADMIN_CHAT_ID`) should receive that text along with the sender's Telegram ID and username.

## Customization

- **Change the frequency**: edit the Cron Trigger schedule in the dashboard (Settings → Triggers).
- **Change the menu text or buttons**: edit `mainMenuKeyboard()` in `worker.js`.
- **Add more buttons**: add entries to `mainMenuKeyboard()` and a matching `if (cq.data === '...')` branch in `handleCallbackQuery()`.
- **Switch data provider**: edit the URL in `fetchPricesMessage()` and adjust the `usd_sell` / `18ayar` field names if needed.

## Notes

- If the bot token is ever exposed (e.g. pasted somewhere public), revoke it with `/revoke` in `@BotFather` and update the `TELEGRAM_BOT_TOKEN` secret — the webhook keeps working once you update the secret, no need to re-register it.
- The KV entry for an unanswered "custom bot" request expires automatically after 1 day, so a user can't accidentally trigger a forward days later by sending an unrelated message.
- Free-tier limits (100,000 requests/day, 5 cron triggers/account) are far above what a personal bot like this needs.

## Project structure

```
.
└── worker.js
```

No build step, no dependencies, no `package.json` needed — this single file is pasted directly into the Cloudflare dashboard editor.
