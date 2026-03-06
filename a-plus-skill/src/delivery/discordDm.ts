export type DiscordDmConfig = {
  botToken: string;
  recipientUserId: string;
};

type DiscordDmChannelResponse = {
  id?: string;
};

type FetchLike = typeof fetch;

const DISCORD_API_BASE = 'https://discord.com/api/v10';

function assertOk(value: string | undefined, name: string): string {
  const v = value?.trim();
  if (!v) throw new Error(`missing ${name}`);
  return v;
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
    throw new Error(`open DM failed: HTTP_${response.status}`);
  }

  const data = (await response.json()) as DiscordDmChannelResponse;
  const channelId = data?.id?.trim();
  if (!channelId) throw new Error('open DM failed: missing channel id');
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
    throw new Error(`send DM failed: HTTP_${response.status}`);
  }

  const data = (await response.json()) as { id?: string };
  return {
    channelId,
    messageId: data?.id
  };
}
