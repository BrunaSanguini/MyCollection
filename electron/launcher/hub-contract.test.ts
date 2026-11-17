import { createServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import {
  anyFreePort,
  isPortFree,
  isReady,
  portOf,
  requestShutdown,
  waitUntilReady,
  withPort,
  withPortArgument,
  type Fetch,
} from './hub-contract';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('URLs e porta', () => {
  it('lê a porta da URL, ou a padrão do protocolo', () => {
    expect(portOf('http://127.0.0.1:8471/')).toBe(8471);
    expect(portOf('http://localhost/')).toBe(80);
    expect(portOf('https://localhost/')).toBe(443);
  });

  it('troca a porta e, se pedido, o caminho', () => {
    expect(withPort('http://127.0.0.1:8471/', 8480)).toBe('http://127.0.0.1:8480/');
    expect(withPort('http://127.0.0.1:8471/estante?x=1', 8480, '/actuator/shutdown')).toBe(
      'http://127.0.0.1:8480/actuator/shutdown',
    );
  });

  it('passa a porta como argumento do Spring Boot', () => {
    expect(withPortArgument('MinhaLivraria.exe ', 8471)).toBe('MinhaLivraria.exe --server.port=8471');
  });
});

describe('isReady', () => {
  it('só está pronto com 200 e status UP', async () => {
    expect(await isReady('http://x/r', async () => json(200, { status: 'UP' }))).toBe(true);
    expect(await isReady('http://x/r', async () => json(200, { status: 'DOWN' }))).toBe(false);
    expect(await isReady('http://x/r', async () => json(503, { status: 'OUT_OF_SERVICE' }))).toBe(false);
    expect(await isReady('http://x/r', async () => new Response('<html>'))).toBe(false);
    expect(
      await isReady('http://x/r', async () => {
        throw new TypeError('fetch failed');
      }),
    ).toBe(false);
  });
});

describe('waitUntilReady', () => {
  function clock() {
    let now = 0;
    const pauses: number[] = [];
    return {
      pauses,
      now: () => now,
      sleep: async (ms: number) => {
        pauses.push(ms);
        now += ms;
      },
    };
  }

  it('pergunta com pausa que dobra até 2 s', async () => {
    const c = clock();
    let calls = 0;
    const fetchFn: Fetch = async () => json(200, { status: ++calls >= 7 ? 'UP' : 'DOWN' });
    const result = await waitUntilReady({
      readinessUrl: 'http://x/r',
      timeoutMs: 60_000,
      signal: new AbortController().signal,
      exited: () => false,
      fetch: fetchFn,
      ...c,
    });
    expect(result).toBe('ready');
    expect(c.pauses).toEqual([200, 400, 800, 1600, 2000, 2000]);
  });

  it('desiste no tempo máximo', async () => {
    const c = clock();
    const result = await waitUntilReady({
      readinessUrl: 'http://x/r',
      timeoutMs: 5_000,
      signal: new AbortController().signal,
      exited: () => false,
      fetch: async () => json(503, {}),
      ...c,
    });
    expect(result).toBe('timeout');
  });

  it('para quando o processo termina antes de ficar pronto', async () => {
    const c = clock();
    let alive = 2;
    const result = await waitUntilReady({
      readinessUrl: 'http://x/r',
      timeoutMs: 60_000,
      signal: new AbortController().signal,
      exited: () => alive-- <= 0,
      fetch: async () => json(503, {}),
      ...c,
    });
    expect(result).toBe('exited');
  });

  it('para quando cancelado (PARAR durante o início)', async () => {
    const abort = new AbortController();
    abort.abort();
    const result = await waitUntilReady({
      readinessUrl: 'http://x/r',
      timeoutMs: 60_000,
      signal: abort.signal,
      exited: () => false,
      fetch: async () => json(200, { status: 'UP' }),
    });
    expect(result).toBe('aborted');
  });
});

describe('requestShutdown', () => {
  it('faz POST sem corpo, com o token no cabeçalho do hub', async () => {
    const fetchFn = vi.fn<Fetch>(async () => json(200, { message: 'bye' }));
    expect(await requestShutdown('http://x/actuator/shutdown', 'abc', fetchFn)).toBe(200);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://x/actuator/shutdown');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toEqual({ 'X-MyCollection-Token': 'abc' });
  });

  it('devolve o status de uma recusa e null sem resposta', async () => {
    expect(await requestShutdown('http://x/s', 'abc', async () => json(403, {}))).toBe(403);
    expect(
      await requestShutdown('http://x/s', 'abc', async () => {
        throw new TypeError('fetch failed');
      }),
    ).toBeNull();
  });
});

describe('portas', () => {
  it('sabe se a porta está ocupada e acha uma livre', async () => {
    const port = await anyFreePort();
    expect(await isPortFree(port)).toBe(true);
    const server = createServer().listen(port, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      expect(await isPortFree(port)).toBe(false);
    } finally {
      server.close();
    }
  });
});
