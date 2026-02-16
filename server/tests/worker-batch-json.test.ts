import { afterEach, describe, expect, it, vi } from 'vitest';

type ControlPlaneMode = 'ok' | 'throw';

function createOpenRouterResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content,
          },
        },
      ],
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

function createEnv(options?: { controlPlaneMode?: ControlPlaneMode }) {
  const mode = options?.controlPlaneMode ?? 'ok';
  const store = new Map<string, string>();

  const controlPlane = {
    idFromName() {
      return {} as any;
    },
    get() {
      return {
        async fetch(input: string) {
          if (mode === 'throw') {
            throw new Error('control-plane unavailable');
          }

          const path = new URL(input).pathname;
          if (path === '/rate/check') {
            return new Response(JSON.stringify({ blocked: false, blockedUntil: 0 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (path === '/circuit/check') {
            return new Response(JSON.stringify({ open: false, openUntil: 0 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (path === '/circuit/failure') {
            return new Response(JSON.stringify({ opened: false, openUntil: 0 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (path === '/circuit/success') {
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      } as any;
    },
  };

  return {
    AI_SESSIONS: {
      async get(key: string) {
        return store.get(key) ?? null;
      },
      async put(key: string, value: string) {
        store.set(key, value);
      },
      async delete(key: string) {
        store.delete(key);
      },
    },
    CONTROL_PLANE_DO: controlPlane,
    KEY_ENCRYPTION_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ALLOW_INSECURE_DEV_AUTH: 'true',
    DEFAULT_MODEL: 'google/gemini-2.5-flash',
  } as any;
}

async function loadWorker() {
  const module = await import('../../worker/src/index.ts');
  return module.default;
}

async function connectLegacySession(worker: Awaited<ReturnType<typeof loadWorker>>, env: any): Promise<string> {
  const response = await worker.fetch(
    new Request('https://worker.example/api/v1/auth/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'openrouter',
        apiKey: 'openrouter-test-key',
      }),
    }),
    env
  );

  expect(response.status).toBe(200);
  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();
  return String(setCookie).split(';')[0];
}

describe('worker batch JSON parsing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('parses fenced JSON arrays from OpenRouter and returns all batch items', async () => {
    const worker = await loadWorker();
    const env = createEnv();

    let providerCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('openrouter.ai/api/v1/chat/completions')) {
        throw new Error(`Unexpected fetch target in test: ${url}`);
      }

      providerCalls += 1;
      if (providerCalls === 1) {
        return createOpenRouterResponse('OK');
      }

      return createOpenRouterResponse(`\`\`\`json
[
  {
    "content": "Idea one",
    "title": "First idea",
    "tags": ["startup"],
    "type": "IDEA"
  },
  {
    "content": "Task two",
    "title": "Second task",
    "tags": ["todo"],
    "type": "TASK"
  }
]
\`\`\``);
    });

    const cookie = await connectLegacySession(worker, env);
    const response = await worker.fetch(
      new Request('https://worker.example/api/v1/ai/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({
          content: 'idea one\ntask two',
        }),
      }),
      env
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.results).toHaveLength(2);
    expect(payload.results[0]).toMatchObject({
      content: 'Idea one',
      title: 'First idea',
      type: 'IDEA',
    });
    expect(payload.results[1]).toMatchObject({
      content: 'Task two',
      title: 'Second task',
      type: 'TASK',
    });
  });

  it('enforces requested generation count and type for smart batching prompts', async () => {
    const worker = await loadWorker();
    const env = createEnv();

    let providerCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('openrouter.ai/api/v1/chat/completions')) {
        throw new Error(`Unexpected fetch target in test: ${url}`);
      }

      providerCalls += 1;
      if (providerCalls === 1) {
        return createOpenRouterResponse('OK');
      }

      return createOpenRouterResponse(
        JSON.stringify({
          mode: 'generate',
          items: [
            { content: 'Idea A', title: 'Idea A', tags: ['one'], type: 'IDEA' },
            { content: 'Idea B', title: 'Idea B', tags: ['two'], type: 'TASK' },
            { content: 'Idea C', title: 'Idea C', tags: ['three'], type: 'NOTE' },
          ],
        })
      );
    });

    const cookie = await connectLegacySession(worker, env);
    const response = await worker.fetch(
      new Request('https://worker.example/api/v1/ai/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({
          content: 'Create 2 ideas about habit tracking',
        }),
      }),
      env
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.results).toHaveLength(2);
    expect(payload.results[0].type).toBe('IDEA');
    expect(payload.results[1].type).toBe('IDEA');
  });

  it('keeps mixed types and additive counts for multi-clause generation prompts', async () => {
    const worker = await loadWorker();
    const env = createEnv();

    let providerCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('openrouter.ai/api/v1/chat/completions')) {
        throw new Error(`Unexpected fetch target in test: ${url}`);
      }

      providerCalls += 1;
      if (providerCalls === 1) {
        return createOpenRouterResponse('OK');
      }

      return createOpenRouterResponse(
        JSON.stringify({
          mode: 'generate',
          items: [
            { content: 'Idea A', title: 'Idea A', tags: ['ideas'], type: 'IDEA' },
            { content: 'Idea B', title: 'Idea B', tags: ['ideas'], type: 'IDEA' },
            { content: 'Task A', title: 'Task A', tags: ['tasks'], type: 'TASK' },
            { content: 'Task B', title: 'Task B', tags: ['tasks'], type: 'TASK' },
            { content: 'Note extra', title: 'Note extra', tags: ['notes'], type: 'NOTE' },
          ],
        })
      );
    });

    const cookie = await connectLegacySession(worker, env);
    const response = await worker.fetch(
      new Request('https://worker.example/api/v1/ai/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({
          content: 'Create 2 ideas and 2 tasks about habit tracking',
        }),
      }),
      env
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.results).toHaveLength(4);
    expect(payload.results.map((item: { type: string }) => item.type)).toEqual(['IDEA', 'IDEA', 'TASK', 'TASK']);
  });
});
