// Telegram USD & Gold price bot — Cloudflare Workers (free forever)
//
// Two entry points:
//   fetch()      -> handles Telegram webhook updates (menu, buttons, forwarding)
//   scheduled()  -> runs on a Cron Trigger, pushes the price automatically every few hours
//
// Required secrets (Settings -> Variables and Secrets):
//   TELEGRAM_BOT_TOKEN
//   NAVASAN_API_KEY
//   ADMIN_CHAT_ID
//
// Required binding:
//   BOT_STATE - KV namespace

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
  if (!raw) return 'نامشخص';
  const [datePart, timePart = ''] = String(raw).split(' ');
  return toPersianDigits(
    datePart.replace(/-/g, '/') + ' - ' + timePart.slice(0, 5)
  );
}

async function fetchPricesMessage(env) {
  const res = await fetch(
    `http://api.navasan.tech/latest/?api_key=${env.NAVASAN_API_KEY}`
  );

  if (!res.ok) {
    throw new Error(`navasan.tech responded ${res.status}`);
  }

  const data = await res.json();
  const usdItem = data.usd_sell || data.usd || {};
  const goldItem = data['18ayar'] || {};

  const now = new Date();

  const dateStr = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const timeStr = new Intl.DateTimeFormat('fa-IR', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
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
      [
        {
          text: '🤖 ساخت بات شخصی – ۲۹۹,۰۰۰ تومان',
          callback_data: 'custom_bot',
        },
      ],
      [
        {
          text: '💱 آخرین تغییرات دلار و طلا',
          callback_data: 'final_prices',
        },
      ],
    ],
  };
}
const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

const AI_SYSTEM_PROMPT =
  'You are a helpful, concise assistant inside a Telegram bot. Always reply in Persian (Farsi) unless the user writes in another language.';

async function askAI(env, userText) {
  const result = await env.AI.run(AI_MODEL, {
    messages: [
      { role: 'system', content: AI_SYSTEM_PROMPT },
      { role: 'user', content: userText },
    ],
  });

  return result && result.response
    ? result.response.trim()
    : 'متاسفانه نتونستم جواب بدم، دوباره امتحان کن.';
}

const START_BUTTON_TEXT = '▶️ شروع';

function removeReplyKeyboard() {
  return { remove_keyboard: true };
}

function backKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔙 بازگشت', callback_data: 'back_to_menu' }],
    ],
  };
}

async function tg(env, method, payload) {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    console.log(
      `Telegram ${method} failed: ${res.status} ${await res.text()}`
    );
  }

  return res;
}

const sendMessage = (env, chatId, text, replyMarkup) =>
  tg(env, 'sendMessage', {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });

const editMessage = (env, chatId, messageId, text, replyMarkup) =>
  tg(env, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });

const answerCallback = (env, callbackQueryId, text) =>
  tg(env, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });

async function handleCallbackQuery(env, cq) {
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;
  
  if (cq.data === 'custom_bot') {
    await env.BOT_STATE.put(
      `awaiting:${chatId}`,
      'description',
      { expirationTtl: 86400 }
    );

    await editMessage(
      env,
      chatId,
      messageId,
      '✍️ لطفاً در یک پیام بنویسید این بات رو برای چه کاری می‌خواید (نوع کسب‌وکار، امکانات موردنظر و ...).\n\n' +
        'بعد از ارسال، من پیامتون رو می‌بینم و باهاتون هماهنگ می‌کنم.',
      backKeyboard()
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

  if (cq.data === 'ai_chat') {
    await env.BOT_STATE.put(
      `awaiting:${chatId}`,
      'ai_chat',
      { expirationTtl: 86400 }
    );

    await editMessage(
      env,
      chatId,
      messageId,
      '🧠 حالا هر سوالی داری بپرس، جواب می‌دم.\n\nبرای خروج از این حالت، دکمه‌ی بازگشت رو بزن یا /start رو بفرست.',
      backKeyboard()
    );

    await answerCallback(env, cq.id);
    return;
  }

  if (cq.data === 'back_to_menu') {
    await env.BOT_STATE.delete(`awaiting:${chatId}`);

    await editMessage(
      env,
      chatId,
      messageId,
      `🏠 منوی اصلی\n\n🆔 آیدی عددی شما: ${chatId}`,
      mainMenuKeyboard()
    );

    await answerCallback(env, cq.id);
    return;
  }

  await answerCallback(env, cq.id);
}

async function handleMessage(env, msg) {
  const chatId = msg.chat.id;
  if (msg.text === '/start' || msg.text === START_BUTTON_TEXT) {
    await env.BOT_STATE.delete(`awaiting:${chatId}`);

    const subscriberKey = `subscriber:${chatId}`;
    const isNew = !(await env.BOT_STATE.get(subscriberKey));

    if (isNew) {
      await env.BOT_STATE.put(subscriberKey, '1');
    }

    // Notify the admin every time a user starts the bot.
    if (String(chatId) !== String(env.ADMIN_CHAT_ID)) {
      const fullName =
        [msg.from.first_name, msg.from.last_name]
          .filter(Boolean)
          .join(' ') || 'ندارد';

      const startLabel = isNew
        ? '🆕 کاربر جدید /start زد'
        : '🔄 کاربر دوباره /start زد';

      await sendMessage(
        env,
        env.ADMIN_CHAT_ID,
        startLabel + '\n' +
          '🆔 آیدی: ' + chatId + '\n' +
          '👤 نام: ' + fullName + '\n' +
          '🔗 یوزرنیم: ' +
          (msg.from.username ? '@' + msg.from.username : 'ندارد')
      );
    }

    await sendMessage(
      env,
      chatId,
      `👋 سلام ${msg.from.first_name || ''}!\nبه بات قیمت دلار و طلا خوش اومدید.\n\n` +
        `🆔 آیدی عددی شما: ${chatId}\n\n` +
        'هر چند ساعت قیمت روز رو خودکار دریافت می‌کنید. از منوی زیر هم می‌تونید استفاده کنید:',
      mainMenuKeyboard()
    );

    // Remove any old reply keyboard.
    try {
      const cleared = await tg(env, 'sendMessage', {
        chat_id: chatId,
        text: '✅',
        reply_markup: removeReplyKeyboard(),
      });

      const body = await cleared.json();

      if (body && body.ok) {
        await tg(env, 'deleteMessage', {
          chat_id: chatId,
          message_id: body.result.message_id,
        });
      }
    } catch (e) {
      // Cosmetic only; ignore failures.
    }

    return;
  }
   const awaiting = await env.BOT_STATE.get(`awaiting:${chatId}`);

  if (awaiting === 'description') {
    await env.BOT_STATE.delete(`awaiting:${chatId}`);

    const adminText =
      `📩 درخواست ساخت بات شخصی\n` +
      `🆔 آیدی: ${chatId}\n` +
      `👤 یوزرنیم: @${msg.from.username || 'ندارد'}\n\n` +
      `متن پیام:\n${msg.text || '(بدون متن)'}`;

    await sendMessage(env, env.ADMIN_CHAT_ID, adminText);
    await sendMessage(
      env,
      chatId,
      '✅ پیام شما ارسال شد. به‌زودی باهاتون هماهنگ می‌کنیم.'
    );

    return;
  }

  if (awaiting === 'ai_chat') {
    if (!msg.text) {
      await sendMessage(
        env,
        chatId,
        'فعلاً فقط پیام متنی رو می‌فهمم 🙂'
      );
      return;
    }

    const reply = await askAI(env, msg.text);
    await sendMessage(env, chatId, reply, backKeyboard());
    return;
  }

  // Unknown messages are ignored.
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('OK');
    }

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
      })()
    );
  },
};
