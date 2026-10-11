import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

// A dedicated worker is destroyed when the assistant closes or the account changes.
// No service worker, chat persistence, tools or shared engine is used.
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (event: MessageEvent) => { handler.onmessage(event); };
