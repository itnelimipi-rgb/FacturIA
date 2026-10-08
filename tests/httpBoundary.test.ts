import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { GET as health } from '../src/app/api/health/route';
import { POST as authPost } from '../src/app/api/auth/[...all]/route';
import { HttpError, readJson } from '../src/server/http';

const keys = ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET'] as const;
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
for (const key of keys) delete process.env[key];
after(() => {
  for (const key of keys) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const url = 'http://localhost:3000/api/auth/sign-in/email';

 test('auth rejects an oversized declared body before consulting authentication or the database', async () => {
  const response = await authPost(new Request(url, {
    method: 'POST', headers: {'content-type': 'application/json', 'content-length': '64001'}, body: '{}'
  }));
  assert.equal(response.status, 413);
});

test('auth counts a chunked body with no content-length and returns 413 before parsing it', async () => {
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"name":"'));
    controller.enqueue(new TextEncoder().encode('x'.repeat(64_001)));
    controller.close();
  } });
  const response = await authPost(new Request(url, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: stream, duplex: 'half'
  } as RequestInit & {duplex: 'half'}));
  assert.equal(response.status, 413);
});

test('auth rejects malformed JSON and unsupported body types with controlled HTTP errors', async () => {
  const malformed = await authPost(new Request(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{'}));
  assert.equal(malformed.status, 400);
  const wrongMedia = await authPost(new Request(url, {method: 'POST', headers: {'content-type': 'text/plain'}, body: '{}'}));
  assert.equal(wrongMedia.status, 415);
});

test('JSON does not silently replace invalid UTF-8 bytes in credentials or document text', async () => {
  const bytes = Buffer.concat([Buffer.from('{"name":"'), Buffer.from([0xC3, 0x28]), Buffer.from('"}')]);
  const input = new Request(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: bytes});
  await assert.rejects(readJson(input), (reason: unknown) => reason instanceof HttpError && reason.status === 400);
});

test('health reports unavailable for a configured workspace with an unusable auth secret without connecting', async () => {
  process.env.DATABASE_URL = 'postgres://unused.test/never-connected';
  process.env.BETTER_AUTH_URL = 'http://localhost:3000';
  process.env.BETTER_AUTH_SECRET = 'too-short';
  try {
    const response = await health();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {status: 'unavailable', mode: 'workspace'});
  } finally {
    for (const key of keys) delete process.env[key];
  }
});

test('health does not report a healthy demo when backend configuration is only partially supplied', async () => {
  process.env.BETTER_AUTH_URL = 'http://localhost:3000';
  try {
    const response = await health();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {status: 'unavailable', mode: 'workspace'});
  } finally { delete process.env.BETTER_AUTH_URL; }
});
