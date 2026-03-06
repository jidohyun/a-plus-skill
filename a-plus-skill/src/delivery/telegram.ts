export type TelegramConfig = {
  botToken: string;
  chatId: string;
};

type FetchLike = typeof fetch;

const TELEGRAM_API_BASE = 'https://api.telegram.org';

export class TelegramSendError extends Error {
  status?: number;
  retryAfterMs?: number;
  code: string;

  constructor(code: string, message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
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
    const retryAfter = (body as { parameters?: { retry_after?: unknown } }).parameters?.retry_after;
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
      return Math.ceil(retryAfter * 1000);
    }
  }

  return undefined;
}

export async function sendTelegramMessage(
  content: string,
  fetcher: FetchLike = fetch,
  config?: Partial<TelegramConfig>
): Promise<{ ok: true; messageId?: number }> {
  const botToken = assertOk(config?.botToken ?? process.env.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN');
  const chatId = assertOk(config?.chatId ?? process.env.TELEGRAM_CHAT_ID, 'TELEGRAM_CHAT_ID');

  const response = await fetcher(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ chat_id: chatId, text: content })
  });

  if (!response.ok) {
    const body = await parseJsonSafe(response);
    const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response, body) : undefined;
    throw new TelegramSendError('SEND_MESSAGE_FAILED', `send message failed: HTTP_${response.status}`, response.status, retryAfterMs);
  }

  const data = (await response.json()) as { ok?: boolean; result?: { message_id?: number } };
  if (!data?.ok) {
    throw new TelegramSendError('SEND_MESSAGE_FAILED', 'send message failed: API_NOT_OK');
  }

  return { ok: true, messageId: data.result?.message_id };
}

export function createTelegramSender(
  fetcher: FetchLike = fetch,
  config?: Partial<TelegramConfig>
): (content: string) => Promise<{ ok: true; messageId?: number }> {
  return (content: string) => sendTelegramMessage(content, fetcher, config);
}
