// Telegram USD & Gold price bot — Cloudflare Workers (free forever)
//
// Two entry points:
//   fetch()      -> handles Telegram webhook updates (menu, buttons, forwarding)
//   scheduled()  -> runs on a Cron Trigger, pushes the price automatically every few hours
//
// Required secrets (Settings -> Variables and Secrets):
//   TELEGRAM_BOT_TOKEN  - from @BotFather
//   NAVASAN_API_KEY     - from navasan.tech
//   ADMIN_CHAT_ID       - your own numeric Telegram chat ID (the only person who sees custom-bot requests)
//
// Required binding (Settings -> Bindings -> KV Namespace):
//   BOT_STATE           - any KV namespace, used to remember "this user is typing a description"

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function toPersianDigits(s) {
  return String(s).replace(/\d/g, (d) => PERSIAN_DIGITS[d]);
}

function fmtNumber(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 'نامشخص';
  return toPersianDigits(n.toLocaleString('en-US')).replace(/,/g, '٬');
}

function fmtLastChange(raw) {
  // navasan.tech returns e.g. "1405-07-05 21:01:55" (Jalali date, already local time)
  if (!raw) return 'نامشخص';
  const [datePart, timePart = ''] = String(raw).split(' ');
  return toPersianDigits(datePart.replace(/-/g, '/') + ' - ' + timePart.slice(0, 5));
}

async function fetchPricesMessage(env) {
  const res = await fetch(`http://api.navasan.tech/latest/?api_key=${env.NAVASAN_API_KEY}`);
  if (!res.ok) throw new Error(`navasan.tech responded ${res.status}`);
  const data = await res.json();

  // ⚠️ Adjust these two keys if navasan.tech ever changes its response field names.
  const usdItem = data.usd_sell || data.usd || {};
  const goldItem = data['18ayar'] || {};

  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const timeStr = new Intl.DateTimeFormat('fa-IR', {
    timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);

  return (
    `💵 دلار: ${fmtNumber(usdItem.value)} تومان\n` +
    `🕐 آخرین تغییر: ${fmtLastChange(usdItem.date)}\n\n` +
    `🥇 طلای ۱۸ عیار: ${fmtNumber(goldItem.value)} تومان\n` +
    `🕐 آخرین تغییر: ${fmtLastChange(goldItem.date)}\n\n` +
    `📅 تاریخ دریافت: ${dateStr}\n` +
    `⏰ ساعت دریافت: ${timeStr}`
  );
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🤖 ساخت بات شخصی – ۲۹۹,۰۰۰ تومان', callback_data: 'custom_bot' }],
      [{ text: '💱 آخرین تغییرات دلار و طلا', callback_data: 'final_prices' }],
    ],
  };
}

function backKeyboard() {
  return { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'back_to_menu' }]] };
}

async function tg(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.log(`Telegram ${method} failed: ${res.status} ${await res.text()}`);
  }
  return res;
}

const sendMessage = (env, chatId, text, replyMarkup) =>
  tg(env, 'sendMessage', { chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });

const editMessage = (env, chatId, messageId, text, replyMarkup) =>
  tg(env, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });

const answerCallback = (env, callbackQueryId, text) =>
  tg(env, 'answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });

async function handleCallbackQuery(env, cq) {
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;

  if (cq.data === 'custom_bot') {
    await env.BOT_STATE.put(`awaiting:${chatId}`, '1', { expirationTtl: 86400 }); // expires after 1 day if unused
    await editMessage(
      env, chatId, messageId,
      '✍️ لطفاً در یک پیام بنویسید این بات رو برای چه کاری می‌خواید (نوع کسب‌وکار، امکانات موردنظر و ...).\n\n' +
        'بعد از ارسال، من پیامتون رو می‌بینم و باهاتون هماهنگ می‌کنم.',
      backKeyboard(),
    );
    await answerCallback(env, cq.id);
    return;
  }

  if (cq.data === 'final_prices') {
    const text = await fetchPricesMessage(env);
    await sendMessage(env, chatId, text);
    await answerCallback(env, cq.id);
    return;
  }

  if (cq.data === 'back_to_menu') {
    await env.BOT_STATE.delete(`awaiting:${chatId}`);
    await editMessage(env, chatId, messageId, `🏠 منوی اصلی\n\n🆔 آیدی عددی شما: ${chatId}`, mainMenuKeyboard());
    await answerCallback(env, cq.id);
    return;
  }

  await answerCallback(env, cq.id);
}

async function handleMessage(env, msg) {
  const chatId = msg.chat.id;

  if (msg.text === '/start') {
    await env.BOT_STATE.delete(`awaiting:${chatId}`);
    await sendMessage(
      env, chatId,
      `👋 سلام ${msg.from.first_name || ''}!\nبه بات قیمت دلار و طلا خوش اومدید.\n\n` +
        `🆔 آیدی عددی شما: ${chatId}\n\n` +
        'هر چند ساعت قیمت روز رو خودکار دریافت می‌کنید. از منوی زیر هم می‌تونید استفاده کنید:',
      mainMenuKeyboard(),
    );
    return;
  }

  const awaiting = await env.BOT_STATE.get(`awaiting:${chatId}`);
  if (awaiting) {
    await env.BOT_STATE.delete(`awaiting:${chatId}`);
    const adminText =
      `📩 درخواست ساخت بات شخصی\n` +
      `🆔 آیدی: ${chatId}\n` +
      `👤 یوزرنیم: @${msg.from.username || 'ندارد'}\n\n` +
      `متن پیام:\n${msg.text || '(بدون متن)'}`;
    await sendMessage(env, env.ADMIN_CHAT_ID, adminText);
    await sendMessage(env, chatId, '✅ پیام شما ارسال شد. به‌زودی باهاتون هماهنگ می‌کنیم.');
  }
  // Otherwise: not a command we recognize and not an active conversation — stay silent.
  // The bot's main job (periodic price push) keeps running regardless, via scheduled().
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('OK');

    let update;
    try {
      update = await request.json();
    } catch (e) {
      return new Response('OK');
    }

    try {
      if (update.callback_query) {
        await handleCallbackQuery(env, update.callback_query);
      } else if (update.message) {
        await handleMessage(env, update.message);
      }
    } catch (e) {
      console.log('Error handling update: ' + e.message);
    }

    return new Response('OK');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const text = await fetchPricesMessage(env);
        await sendMessage(env, env.ADMIN_CHAT_ID, text);
      })(),
    );
  },
};
