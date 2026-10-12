import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LocalAiSetupError, localAiSetupDiagnostic, withLocalAiDeadline} from '../src/lib/localAssistant';

const namedError = (name: string, message = 'PRIVATE_ERROR_DETAIL') => Object.assign(new Error(message), {name});
const category = (value: unknown, expected: string) => assert.equal(localAiSetupDiagnostic(value).code, `AI_SETUP_${expected}`);

test('real WebLLM string rejections retain download diagnosis through Error prefixes', () => {
  for (const input of [
    'Error: Cannot fetch https://huggingface.co/mlc-ai/model/resolve/main/params_shard_0.bin',
    'Error: TypeError: Failed to fetch',
    'TypeError: Failed to fetch',
    'Error: Load failed.',
    '  Error: TypeError: Failed to fetch  ',
  ]) category(input, 'DOWNLOAD');
});

test('named browser and WebLLM errors distinguish GPU, cache and model configuration', () => {
  for (const input of [namedError('ShaderF16SupportError'), namedError('DeviceLostError'), namedError('WebGPUNotAvailableError')]) category(input, 'GPU');
  for (const input of [new DOMException('PRIVATE_STORAGE_PATH', 'QuotaExceededError'), namedError('CrossContextLockUnavailableError'), namedError('ReferenceError', 'caches is not defined'), namedError('SecurityError', "Failed to read the 'caches' property from 'Window': access denied")]) category(input, 'STORAGE');
  for (const input of [namedError('SpecifiedModelNotFoundError'), namedError('MissingModelWasmError'), new WebAssembly.CompileError('PRIVATE_WASM_ARTIFACT')]) category(input, 'MODEL_CONFIG');
  category(new DOMException('PRIVATE_CANCEL_REASON', 'AbortError'), 'CANCELLED');
  category(new DOMException('PRIVATE_TIMEOUT_REASON', 'TimeoutError'), 'TIMEOUT');
});

test('WebGPU words inside download URLs or arbitrary text never masquerade as GPU failures', () => {
  for (const input of [namedError('Error', 'Cannot fetch https://example.test/webgpu/device-lost?token=PRIVATE_TOKEN'), 'Error: Cannot fetch https://example.test/webgpu/weights.bin']) category(input, 'DOWNLOAD');
  for (const input of ['https://example.test/WebGPUNotAvailableError?secret=PRIVATE_TOKEN', 'The app mentioned webgpu near PRIVATE_TOKEN', namedError('Error', 'PRIVATE_TOKEN webgpu ShaderF16SupportError')]) category(input, 'UNKNOWN');
});

test('diagnostics expose only static allowlisted text and never inspect arbitrary object secrets', () => {
  let getterReads = 0;
  const arbitrary = {name: 'DeviceLostError', secret: 'PRIVATE_OBJECT_SECRET', get message() { getterReads++; throw new Error('PRIVATE_GETTER_SECRET'); }};
  for (const input of [arbitrary, {message: 'PRIVATE_OBJECT_SECRET'}, null, undefined, 123, namedError('TypeError', 'PRIVATE_URL https://example.test/?token=PRIVATE_TOKEN'), 'PRIVATE_QUESTION RFC AAA010101AAA password PRIVATE_PASSWORD']) {
    const diagnostic = localAiSetupDiagnostic(input);
    assert.deepEqual(Object.keys(diagnostic).sort(), ['code', 'message']);
    assert.ok(!JSON.stringify(diagnostic).includes('PRIVATE'));
    assert.ok(!JSON.stringify(diagnostic).includes('http'));
    category(input, 'UNKNOWN');
  }
  assert.equal(getterReads, 0);
  const supplied = new LocalAiSetupError('download'); supplied.message = 'PRIVATE_MUTATED_MESSAGE';
  const diagnostic = localAiSetupDiagnostic(supplied);
  assert.equal(diagnostic.code, 'AI_SETUP_DOWNLOAD'); assert.ok(!diagnostic.message.includes('PRIVATE'));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {resolve = onResolve; reject = onReject;});
  return {promise, resolve, reject};
}
const isCategory = (expected: string) => (error: unknown) => error instanceof LocalAiSetupError && error.category === expected;

test('deadline rejects exactly at its boundary and consumes a later worker rejection', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const work = deferred<string>(); const controller = new AbortController();
  let rejected = false;
  const bounded = withLocalAiDeadline(work.promise, controller.signal, 1000);
  void bounded.catch(() => {rejected = true;});
  const expectedFailure = assert.rejects(bounded, isCategory('timeout'));
  context.mock.timers.tick(999); await Promise.resolve(); assert.equal(rejected, false);
  context.mock.timers.tick(1); await expectedFailure; assert.equal(rejected, true);
  work.reject(new Error('PRIVATE_LATE_WORKER_FAILURE'));
  await new Promise(resolve => setImmediate(resolve));
});

test('an already aborted signal preserves a typed reason and still handles late rejection', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const controller = new AbortController(); const reason = new LocalAiSetupError('timeout');
  controller.abort(reason);
  const work = deferred<string>();
  await assert.rejects(withLocalAiDeadline(work.promise, controller.signal, 10_000), error => error === reason);
  work.reject(new Error('PRIVATE_LATE_FAILURE_AFTER_PRE_ABORT'));
  context.mock.timers.tick(10_000);
  await new Promise(resolve => setImmediate(resolve));
});

test('user cancellation sanitizes arbitrary abort reasons and removes its listener', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const controller = new AbortController(); const work = deferred<string>();
  const remove = context.mock.method(controller.signal, 'removeEventListener');
  const bounded = withLocalAiDeadline(work.promise, controller.signal, 1000);
  const expectedFailure = assert.rejects(bounded, error => isCategory('cancelled')(error) && error instanceof Error && !error.message.includes('PRIVATE'));
  controller.abort(new Error('PRIVATE_PASSWORD_OR_REQUEST_BODY'));
  await expectedFailure;
  assert.equal(remove.mock.calls.length, 1); assert.equal(remove.mock.calls[0].arguments[0], 'abort');
  work.reject(new Error('PRIVATE_CANCELLED_WORKER_FAILURE'));
  context.mock.timers.tick(1000); await new Promise(resolve => setImmediate(resolve));
});

test('successful work wins before the deadline, clears cancellation hooks and preserves its value', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const controller = new AbortController(); const work = deferred<{ready: boolean}>();
  const remove = context.mock.method(controller.signal, 'removeEventListener');
  const bounded = withLocalAiDeadline(work.promise, controller.signal, 1000);
  const value = {ready: true}; work.resolve(value);
  assert.equal(await bounded, value); assert.equal(remove.mock.calls.length, 1);
  controller.abort(new LocalAiSetupError('gpu')); context.mock.timers.tick(1000);
  assert.equal(await bounded, value);
});

test('a worker failure before the deadline remains available for sanitized diagnostic classification', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const failure = namedError('MissingModelWasmError', 'PRIVATE_CATALOG_URL');
  const controller = new AbortController(); const work = deferred<string>();
  const bounded = withLocalAiDeadline(work.promise, controller.signal, 1000);
  const expectedFailure = assert.rejects(bounded, error => error === failure);
  work.reject(failure); await expectedFailure;
  category(failure, 'MODEL_CONFIG'); context.mock.timers.tick(1000);
});
