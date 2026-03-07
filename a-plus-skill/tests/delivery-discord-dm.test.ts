import { describe, expect, it } from 'vitest';
import { createDiscordDmSender } from '../src/delivery/discordDm.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('createDiscordDmSender', () => {
  it('sends successfully with opened DM channel', async () => {
    const fetchMock = async (url: string | URL): Promise<Response> => {
      const value = typeof url === 'string' ? url : url.toString();
      if (value.endsWith('/users/@me/channels')) {
        return jsonResponse(200, { id: 'dm-1' });
      }
      if (value.endsWith('/channels/dm-1/messages')) {
        return jsonResponse(200, { id: 'msg-1' });
      }
      throw new Error(`unexpected url: ${value}`);
    };

    const sender = createDiscordDmSender(fetchMock as typeof fetch, {
      botToken: 'token',
      recipientUserId: 'user'
    });

    const result = await sender('hello');
    expect(result).toEqual({ channelId: 'dm-1', messageId: 'msg-1' });
  });

  it('reopens stale channel and retries once successfully', async () => {
    const calls: string[] = [];
    const fetchMock = async (url: string | URL): Promise<Response> => {
      const value = typeof url === 'string' ? url : url.toString();
      calls.push(value);

      if (calls.length === 1 && value.endsWith('/users/@me/channels')) {
        return jsonResponse(200, { id: 'stale-dm' });
      }
      if (calls.length === 2 && value.endsWith('/channels/stale-dm/messages')) {
        return jsonResponse(404, { code: 10003, message: 'Unknown Channel' });
      }
      if (calls.length === 3 && value.endsWith('/users/@me/channels')) {
        return jsonResponse(200, { id: 'fresh-dm' });
      }
      if (calls.length === 4 && value.endsWith('/channels/fresh-dm/messages')) {
        return jsonResponse(200, { id: 'msg-retry' });
      }

      throw new Error(`unexpected call ${calls.length}: ${value}`);
    };

    const sender = createDiscordDmSender(fetchMock as typeof fetch, {
      botToken: 'token',
      recipientUserId: 'user'
    });

    const result = await sender('hello');
    expect(result).toEqual({ channelId: 'fresh-dm', messageId: 'msg-retry' });
    expect(calls.length).toBe(4);
  });

  it('throws recovery error when reopen/send retry fails', async () => {
    const fetchMock = async (url: string | URL): Promise<Response> => {
      const value = typeof url === 'string' ? url : url.toString();
      if (value.endsWith('/users/@me/channels')) {
        return jsonResponse(200, { id: 'stale-dm' });
      }
      if (value.endsWith('/channels/stale-dm/messages')) {
        return jsonResponse(403, { code: 10003, message: 'Unknown Channel' });
      }
      throw new Error(`unexpected url: ${value}`);
    };

    const sender = createDiscordDmSender(fetchMock as typeof fetch, {
      botToken: 'token',
      recipientUserId: 'user'
    });

    await expect(sender('hello')).rejects.toMatchObject({
      code: 'SEND_DM_RECOVERY_FAILED'
    });
  });
});
