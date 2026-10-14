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
    `⏰ ساعت دریافت: ${timeStr}\n\n` +
    `💡 محاسبه قیمت دلخواه:\n` +
    `برای قیمت دلار، عدد + دلار بفرستید؛ مثل 10 دلار\n` +
    `برای قیمت طلای ۱۸ عیار، عدد + گرم بفرستید؛ مثل 3 گرم`
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

// Register the commands shown in Telegram's chat menu.
// BOT_STATE prevents repeating the registration on every update.
async function registerBotCommands(env) {
  const registered = await env.BOT_STATE.get('telegram_commands_registered');
  if (registered === '1') return;

  const response = await tg(env, 'setMyCommands', {
    commands: [
      { command: 'start', description: 'شروع و نمایش منوی اصلی' },
      { command: 'stop', description: 'توقف دریافت قیمت‌های دوره‌ای' },
      { command: 'price', description: 'دریافت آخرین قیمت دلار و طلا' },
    ],
  });

  try {
    const result = await response.clone().json();
    if (response.ok && result && result.ok) {
      await env.BOT_STATE.put('telegram_commands_registered', '1');
      console.log('Telegram bot commands registered.');
    } else {
      console.log('Could not register Telegram bot commands:', JSON.stringify(result));
    }
  } catch (e) {
    console.log('Could not read setMyCommands response:', e.message);
  }
}

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
  const command = (msg.text || '').trim().split(/\s+/)[0].split('@')[0];

  // In groups, answer only exact requests such as "10 دلار" or "10 گرم".
  if (
    (msg.chat.type === 'group' || msg.chat.type === 'supergroup') &&
    typeof msg.text === 'string'
  ) {
    const normalizedText = msg.text
      .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .trim();
    const priceMatch = normalizedText.match(/^(\d+)\s*(دلار|گرم)$/);

    if (priceMatch) {
      const amount = Number(priceMatch[1]);
      const unit = priceMatch[2];

      if (Number.isSafeInteger(amount) && amount > 0 && amount <= 100000000) {
        try {
          const res = await fetch(
            `https://api.navasan.tech/latest/?api_key=${env.NAVASAN_API_KEY}`
          );
          if (!res.ok) throw new Error(`navasan.tech responded ${res.status}`);

          const data = await res.json();
          const isDollar = unit === 'دلار';
          const rateItem = isDollar
            ? (data.usd_sell || data.usd || {})
            : (data['18ayar'] || {});
          const rate = Number(rateItem.value);

          if (!Number.isFinite(rate) || rate <= 0) {
            throw new Error('Price rate is missing or invalid');
          }

          const total = amount * rate;
          const reply = isDollar
            ? `💵 قیمت ${fmtNumber(amount)} دلار\n📊 نرخ هر دلار: ${fmtNumber(rate)} تومان\n💰 مبلغ کل: ${fmtNumber(total)} تومان`
            : `🥇 قیمت ${fmtNumber(amount)} گرم طلای ۱۸ عیار\n📊 نرخ هر گرم: ${fmtNumber(rate)} تومان\n💰 مبلغ کل: ${fmtNumber(total)} تومان`;

          await tg(env, 'sendMessage', {
            chat_id: chatId,
            text: reply,
            reply_to_message_id: msg.message_id,
            allow_sending_without_reply: true,
          });
        } catch (e) {
          console.log('Group price calculation failed: ' + e.message);
          await sendMessage(
            env,
            chatId,
            '❌ دریافت نرخ یا محاسبه قیمت موقتاً با مشکل روبه‌رو شد. لطفاً کمی بعد دوباره امتحان کنید.'
          );
        }
      }
      return;
    }
  }

  if (command === '/stop') {
    await env.BOT_STATE.put(`stopped:${chatId}`, '1');
    await env.BOT_STATE.delete(`awaiting:${chatId}`);
    await sendMessage(
      env,
      chatId,
      '🔕 دریافت خودکار قیمت‌ها برای شما متوقف شد. هر زمان خواستید با /start دوباره فعالش کنید.'
    );
    return;
  }

  if (command === '/price') {
    try {
      await sendMessage(env, chatId, await fetchPricesMessage(env));
    } catch (e) {
      console.log('Could not fetch prices for /price: ' + e.message);
      await sendMessage(env, chatId, '❌ دریافت قیمت‌ها موقتاً با مشکل روبه‌رو شد. لطفاً کمی بعد دوباره امتحان کنید.');
    }
    return;
  }

  if (command === '/start' || msg.text === START_BUTTON_TEXT) {
    await env.BOT_STATE.delete(`awaiting:${chatId}`);
    await env.BOT_STATE.delete(`stopped:${chatId}`);

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
      await registerBotCommands(env);
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

        // Preserve the existing admin price update.
        await sendMessage(env, env.ADMIN_CHAT_ID, text);

        // Send scheduled prices to all users who started the bot,
        // except those who opted out with /stop.
        let cursor;
        do {
          const page = await env.BOT_STATE.list({
            prefix: 'subscriber:',
            cursor,
            limit: 1000,
          });

          for (const item of page.keys) {
            const chatId = item.name.slice('subscriber:'.length);
            if (!chatId || String(chatId) === String(env.ADMIN_CHAT_ID)) continue;

            const stopped = await env.BOT_STATE.get(`stopped:${chatId}`);
            if (stopped === '1') continue;

            try {
              await sendMessage(env, chatId, text);
            } catch (e) {
              console.log('Scheduled price send failed for ' + chatId + ': ' + e.message);
            }
          }

          cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor);
      })()
    );
  },
};
