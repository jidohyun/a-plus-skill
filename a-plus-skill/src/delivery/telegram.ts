export type TelegramConfig = {
  botToken: string;
  chatId: string;
};

type FetchLike = typeof fetch;

type TelegramErrorBody = {
  ok?: unknown;
  description?: unknown;
  parameters?: {
    retry_after?: unknown;
    migrate_to_chat_id?: unknown;
  };
  result?: {
    message_id?: unknown;
  };
};

const TELEGRAM_API_BASE = 'https://api.telegram.org';

export class TelegramSendError extends Error {
  status?: number;
  retryAfterMs?: number;
  code: string;
  migrateToChatId?: string;

  constructor(code: string, message: string, status?: number, retryAfterMs?: number, migrateToChatId?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.migrateToChatId = migrateToChatId;
  }
}

function assertOk(value: string | undefined, name: string): string {
  const v = value?.trim();
  if (!v) throw new TelegramSendError('MISSING_CONFIG', `missing ${name}`);
  return v;
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function parseRetryAfterMs(response: Response, body: unknown): number | undefined {
  const header = response.headers.get('retry-after');
  if (header) {
    const numeric = Number(header);
    if (Number.isFinite(numeric)) {
      return Math.ceil(numeric * 1000);
    }

    const dateMs = Date.parse(header);
    if (Number.isFinite(dateMs)) {
      const delta = dateMs - Date.now();
      if (delta > 0) return delta;
    }
  }

  if (body && typeof body === 'object') {
    const retryAfter = (body as TelegramErrorBody).parameters?.retry_after;
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
      return Math.ceil(retryAfter * 1000);
    }
  }

  return undefined;
}

function parseMigrateToChatId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;

  const migrate = (body as TelegramErrorBody).parameters?.migrate_to_chat_id;
  if (typeof migrate === 'string') {
    const trimmed = migrate.trim();
    return trimmed || undefined;
  }

  if (typeof migrate === 'number' && Number.isFinite(migrate)) {
    return String(Math.trunc(migrate));
  }

  return undefined;
}

async function sendToTelegram(
  content: string,
  chatId: string,
  botToken: string,
  fetcher: FetchLike
): Promise<{ ok: true; messageId?: number }> {
  const response = await fetcher(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ chat_id: chatId, text: content })
  });

  const body = await parseJsonSafe(response);
  const migrateToChatId = parseMigrateToChatId(body);

  if (!response.ok) {
    const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response, body) : undefined;

    if (migrateToChatId) {
      throw new TelegramSendError(
        'SEND_MESSAGE_MIGRATE_REQUIRED',
        `send message failed: migrate_to_chat_id=${migrateToChatId}`,
        response.status,
        retryAfterMs,
        migrateToChatId
      );
    }

    throw new TelegramSendError('SEND_MESSAGE_FAILED', `send message failed: HTTP_${response.status}`, response.status, retryAfterMs);
  }

  const data = body as TelegramErrorBody;
  if (!data?.ok) {
    throw new TelegramSendError('SEND_MESSAGE_FAILED', 'send message failed: API_NOT_OK');
  }

  const result = data.result as { message_id?: unknown } | undefined;
  const messageId = typeof result?.message_id === 'number' ? result.message_id : undefined;

  return { ok: true, messageId };
}

export async function sendTelegramMessage(
  content: string,
  fetcher: FetchLike = fetch,
  config?: Partial<TelegramConfig>
): Promise<{ ok: true; messageId?: number }> {
  const botToken = assertOk(config?.botToken ?? process.env.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN');
  const chatId = assertOk(config?.chatId ?? process.env.TELEGRAM_CHAT_ID, 'TELEGRAM_CHAT_ID');
  return sendToTelegram(content, chatId, botToken, fetcher);
}

export function createTelegramSender(
  fetcher: FetchLike = fetch,
  config?: Partial<TelegramConfig>
): (content: string) => Promise<{ ok: true; messageId?: number }> {
  let effectiveChatId: string | null = null;

  return async (content: string) => {
    const botToken = assertOk(config?.botToken ?? process.env.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN');
    const configuredChatId = assertOk(config?.chatId ?? process.env.TELEGRAM_CHAT_ID, 'TELEGRAM_CHAT_ID');

    if (!effectiveChatId) {
      effectiveChatId = configuredChatId;
    }

    try {
      return await sendToTelegram(content, effectiveChatId, botToken, fetcher);
    } catch (error) {
      if (!(error instanceof TelegramSendError) || error.code !== 'SEND_MESSAGE_MIGRATE_REQUIRED' || !error.migrateToChatId) {
        throw error;
      }

      effectiveChatId = error.migrateToChatId;

      try {
        return await sendToTelegram(content, effectiveChatId, botToken, fetcher);
      } catch (retryError) {
        if (retryError instanceof TelegramSendError) {
          throw new TelegramSendError(
            'SEND_MESSAGE_MIGRATE_RETRY_FAILED',
            `send message failed after migrate_to_chat_id retry: ${retryError.code}`,
            retryError.status,
            retryError.retryAfterMs
          );
        }

        throw new TelegramSendError('SEND_MESSAGE_MIGRATE_RETRY_FAILED', 'send message failed after migrate_to_chat_id retry');
      }
    }
  };
}
