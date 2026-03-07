import { describe, expect, it } from 'vitest';
import { createTelegramSender } from '../src/delivery/telegram.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('createTelegramSender', () => {
  it('sends successfully', async () => {
    const fetchMock = async (): Promise<Response> => jsonResponse(200, { ok: true, result: { message_id: 101 } });

    const sender = createTelegramSender(fetchMock as typeof fetch, {
      botToken: 'token',
      chatId: '1000'
    });

    await expect(sender('hello')).resolves.toEqual({ ok: true, messageId: 101 });
  });

  it('updates chat id on migrate_to_chat_id and retries once', async () => {
    const bodies: string[] = [];
    let calls = 0;
    const fetchMock = async (_url: string | URL, init?: RequestInit): Promise<Response> => {
      calls += 1;
      bodies.push(String(init?.body ?? ''));
      if (calls === 1) {
        return jsonResponse(400, {
          ok: false,
          parameters: { migrate_to_chat_id: -2000 }
        });
      }
      return jsonResponse(200, { ok: true, result: { message_id: 202 } });
    };

    const sender = createTelegramSender(fetchMock as typeof fetch, {
      botToken: 'token',
      chatId: '-1000'
    });

    const result = await sender('hello');
    expect(result).toEqual({ ok: true, messageId: 202 });
    expect(calls).toBe(2);
    expect(bodies[0]).toContain('"chat_id":"-1000"');
    expect(bodies[1]).toContain('"chat_id":"-2000"');
  });

  it('throws explicit error when migrate retry fails', async () => {
    let calls = 0;
    const fetchMock = async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(400, {
          ok: false,
          parameters: { migrate_to_chat_id: -2000 }
        });
      }
      return jsonResponse(400, { ok: false, description: 'Bad Request: chat not found' });
    };

    const sender = createTelegramSender(fetchMock as typeof fetch, {
      botToken: 'token',
      chatId: '-1000'
    });

    await expect(sender('hello')).rejects.toMatchObject({
      code: 'SEND_MESSAGE_MIGRATE_RETRY_FAILED'
    });
    expect(calls).toBe(2);
  });

  it('fails immediately for invalid chat/forbidden errors', async () => {
    let calls = 0;
    const fetchMock = async (): Promise<Response> => {
      calls += 1;
      return jsonResponse(403, { ok: false, description: 'Forbidden: bot was blocked by the user' });
    };

    const sender = createTelegramSender(fetchMock as typeof fetch, {
      botToken: 'token',
      chatId: '-1000'
    });

    await expect(sender('hello')).rejects.toMatchObject({
      code: 'SEND_MESSAGE_FAILED',
      status: 403
    });
    expect(calls).toBe(1);
  });
});
