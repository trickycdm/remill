import { describe, it, expect } from 'vitest';
import {
  connectSnippets,
  mcpJsonConfig,
  urlConnectSnippets,
  MILL_URL_PLACEHOLDER,
  CLIENT_TO_SNIPPET,
} from '@/lib/connect-snippets';

const BASE = 'https://remill.me';
const TOKEN = 'rmk_test123';

describe('connect snippets (D48)', () => {
  const byKey = Object.fromEntries(connectSnippets(BASE, TOKEN).map((s) => [s.key, s]));

  it('every card carries the endpoint and the token', () => {
    for (const s of connectSnippets(BASE, TOKEN)) {
      expect(s.code, s.key).toContain(TOKEN);
      expect(s.code, s.key).toContain(s.key === 'curl' ? `${BASE}/api` : `${BASE}/mcp`);
    }
  });

  it('claude mcp add uses the http transport with a bearer header', () => {
    expect(byKey['claude-code'].code).toBe(
      `claude mcp add --transport http remill ${BASE}/mcp --header "Authorization: Bearer ${TOKEN}"`,
    );
  });

  it('.mcp.json parses and matches the shared builder', () => {
    const parsed = JSON.parse(mcpJsonConfig(BASE, TOKEN)) as {
      mcpServers: { remill: { type: string; url: string; headers: Record<string, string> } };
    };
    expect(parsed.mcpServers.remill.type).toBe('http');
    expect(parsed.mcpServers.remill.url).toBe(`${BASE}/mcp`);
    expect(parsed.mcpServers.remill.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(byKey['mcp-json'].code).toBe(mcpJsonConfig(BASE, TOKEN));
  });

  it('cursor deep link decodes to a valid config; caution present', () => {
    const href = byKey['cursor'].deepLink!.href;
    expect(href.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=remill&config=')).toBe(true);
    const b64 = new URL(href).searchParams.get('config')!;
    const decoded = JSON.parse(atob(b64)) as { url: string; headers: Record<string, string> };
    expect(decoded.url).toBe(`${BASE}/mcp`);
    expect(decoded.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(byKey['cursor'].caution).toContain('embeds your token');
  });

  it('vscode deep link decodes to a valid config', () => {
    const href = byKey['vscode'].deepLink!.href;
    expect(href.startsWith('vscode:mcp/install?')).toBe(true);
    const decoded = JSON.parse(decodeURIComponent(href.replace('vscode:mcp/install?', ''))) as {
      name: string;
      type: string;
      url: string;
    };
    expect(decoded).toMatchObject({ name: 'remill', type: 'http', url: `${BASE}/mcp` });
  });

  it('every wizard client value maps to an existing card', () => {
    for (const [client, key] of Object.entries(CLIENT_TO_SNIPPET)) {
      expect(byKey[key], `${client} → ${key}`).toBeTruthy();
    }
  });
});

describe('URL-only connect snippets (homepage quickstart)', () => {
  const snippets = urlConnectSnippets(MILL_URL_PLACEHOLDER);
  const byKey = Object.fromEntries(snippets.map((s) => [s.key, s]));

  it('covers the major clients, each pointing at the placeholder mill with no token', () => {
    expect(snippets.map((s) => s.key)).toEqual(['claude', 'chatgpt', 'gemini', 'copilot', 'cursor', 'claude-code']);
    for (const s of snippets) {
      expect(s.code, s.key).toContain(`${MILL_URL_PLACEHOLDER}/mcp`);
      expect(s.code, s.key).not.toMatch(/Bearer|token/i);
      expect(s.deepLink, s.key).toBeUndefined();
    }
  });

  it('app-UI clients get numbered steps and the bare URL to paste', () => {
    for (const key of ['claude', 'chatgpt']) {
      expect(byKey[key].steps?.length, key).toBeGreaterThan(1);
      expect(byKey[key].code).toBe(`${MILL_URL_PLACEHOLDER}/mcp`);
    }
  });

  it('config-shaped snippets stay valid JSON', () => {
    const cursor = JSON.parse(byKey.cursor.code) as { mcpServers: { remill: { url: string } } };
    expect(cursor.mcpServers.remill.url).toBe(`${MILL_URL_PLACEHOLDER}/mcp`);
    const vscode = /^code --add-mcp '(.*)'$/.exec(byKey.copilot.code)![1];
    expect(JSON.parse(vscode)).toEqual({ name: 'remill', type: 'http', url: `${MILL_URL_PLACEHOLDER}/mcp` });
  });
});

