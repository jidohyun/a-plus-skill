export type DiscordDmConfig = {
  botToken: string;
  recipientUserId: string;
};

type DiscordDmChannelResponse = {
  id?: string;
};

type FetchLike = typeof fetch;

const DISCORD_API_BASE = 'https://discord.com/api/v10';

export class DiscordDmError extends Error {
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
  if (!v) throw new DiscordDmError('MISSING_CONFIG', `missing ${name}`);
  return v;
}

function parseRetryAfterMs(response: Response, body: unknown): number | undefined {
  const header = response.headers.get('retry-after');
  if (header) {
    const numeric = Number(header);
    if (Number.isFinite(numeric)) {
      // Retry-After numeric value is seconds by RFC.
      return Math.ceil(numeric * 1000);
    }

    const dateMs = Date.parse(header);
    if (Number.isFinite(dateMs)) {
      const delta = dateMs - Date.now();
      if (delta > 0) return delta;
    }
  }

  if (body && typeof body === 'object') {
    const v = (body as { retry_after?: unknown }).retry_after;
    if (typeof v === 'number' && Number.isFinite(v)) {
      // Discord JSON retry_after is seconds (can be float)
      return Math.ceil(v * 1000);
    }
  }

  return undefined;
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function openDmChannel(config: DiscordDmConfig, fetcher: FetchLike): Promise<string> {
  const response = await fetcher(`${DISCORD_API_BASE}/users/@me/channels`, {
    method: 'POST',
    headers: {
      authorization: `Bot ${config.botToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ recipient_id: config.recipientUserId })
  });

  if (!response.ok) {
    const body = await parseJsonSafe(response);
    const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response, body) : undefined;
    throw new DiscordDmError('OPEN_DM_FAILED', `open DM failed: HTTP_${response.status}`, response.status, retryAfterMs);
  }

  const data = (await response.json()) as DiscordDmChannelResponse;
  const channelId = data?.id?.trim();
  if (!channelId) throw new DiscordDmError('OPEN_DM_NO_CHANNEL', 'open DM failed: missing channel id');
  return channelId;
}

export async function sendDiscordDm(
  content: string,
  fetcher: FetchLike = fetch,
  config?: Partial<DiscordDmConfig>
): Promise<{ channelId: string; messageId?: string }> {
  const botToken = assertOk(config?.botToken ?? process.env.DISCORD_BOT_TOKEN, 'DISCORD_BOT_TOKEN');
  const recipientUserId = assertOk(config?.recipientUserId ?? process.env.DISCORD_DM_USER_ID, 'DISCORD_DM_USER_ID');

  const channelId = await openDmChannel({ botToken, recipientUserId }, fetcher);

  const response = await fetcher(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bot ${botToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ content })
  });

  if (!response.ok) {
    const body = await parseJsonSafe(response);
    const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response, body) : undefined;
    throw new DiscordDmError('SEND_DM_FAILED', `send DM failed: HTTP_${response.status}`, response.status, retryAfterMs);
  }

  const data = (await response.json()) as { id?: string };
  return {
    channelId,
    messageId: data?.id
  };
}

export function createDiscordDmSender(
  fetcher: FetchLike = fetch,
  config?: Partial<DiscordDmConfig>
): (content: string) => Promise<{ channelId: string; messageId?: string }> {
  let cachedChannelId: string | null = null;

  return async (content: string) => {
    const botToken = assertOk(config?.botToken ?? process.env.DISCORD_BOT_TOKEN, 'DISCORD_BOT_TOKEN');
    const recipientUserId = assertOk(config?.recipientUserId ?? process.env.DISCORD_DM_USER_ID, 'DISCORD_DM_USER_ID');

    if (!cachedChannelId) {
      cachedChannelId = await openDmChannel({ botToken, recipientUserId }, fetcher);
    }

    const response = await fetcher(`${DISCORD_API_BASE}/channels/${cachedChannelId}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bot ${botToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ content })
    });

    if (!response.ok) {
      const body = await parseJsonSafe(response);
      const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response, body) : undefined;
      throw new DiscordDmError('SEND_DM_FAILED', `send DM failed: HTTP_${response.status}`, response.status, retryAfterMs);
    }

    const data = (await response.json()) as { id?: string };
    return { channelId: cachedChannelId, messageId: data?.id };
  };
}
