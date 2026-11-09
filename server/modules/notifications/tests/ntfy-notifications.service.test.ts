import assert from 'node:assert/strict';
import test from 'node:test';

import { readNtfyConfig, sendNtfyNotification } from '@/modules/notifications/services/ntfy-notifications.service.js';

const config = { url: 'https://ntfy.example', topic: 'cloudcli', token: 'secret' };

test('config needs both a url and a topic', () => {
  assert.equal(readNtfyConfig({}), null);
  assert.equal(readNtfyConfig({ NTFY_URL: 'https://ntfy.example' }), null);
  assert.deepEqual(readNtfyConfig({ NTFY_URL: 'https://ntfy.example/', NTFY_TOPIC: 't' }), {
    url: 'https://ntfy.example',
    topic: 't',
    token: undefined,
  });
});

test('publishes JSON with a click url into the wrapper', async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    captured = { url, init };
    return new Response('{}');
  }) as typeof fetch;

  await sendNtfyNotification(config, { title: 'Done', body: 'Claude: ok', data: { sessionId: 'a/b' } }, fetchImpl);

  assert.equal(captured?.url, 'https://ntfy.example');
  assert.equal((captured?.init.headers as Record<string, string>).Authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(String(captured?.init.body)), {
    topic: 'cloudcli',
    title: 'Done',
    message: 'Claude: ok',
    click: 'cloudcli://session/a%2Fb',
  });
});

test('omits click without a session', async () => {
  let body = '';
  const fetchImpl = (async (_: string, init: RequestInit) => {
    body = String(init.body);
    return new Response('{}');
  }) as typeof fetch;
  await sendNtfyNotification(config, { title: 'T', body: 'B', data: {} }, fetchImpl);
  assert.equal('click' in JSON.parse(body), false);
});

test('a failed publish does not throw', async () => {
  const fetchImpl = (async () => new Response('no', { status: 500 })) as typeof fetch;
  await assert.doesNotReject(sendNtfyNotification(config, { title: 'T', body: 'B', data: {} }, fetchImpl));
});
