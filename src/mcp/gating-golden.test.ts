import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildGatingFixture, FIXTURE_PRINCIPALS, type FixturePrincipal } from '@/mcp/gating-fixture';

const GOLDEN_FILE = join(__dirname, 'gating-golden.json');

describe('MCP gating — golden capture of the per-collection tool lists', () => {
  it('tools/list per principal matches the committed golden file', async () => {
    const fx = await buildGatingFixture();
    const actual: Record<string, string[]> = {};
    for (const key of Object.keys(FIXTURE_PRINCIPALS) as FixturePrincipal[]) {
      actual[key] = await fx.toolNames(fx.tokens[key]);
    }
    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(GOLDEN_FILE)) {
      writeFileSync(GOLDEN_FILE, JSON.stringify(actual, null, 2) + '\n');
    }
    expect(actual).toEqual(JSON.parse(readFileSync(GOLDEN_FILE, 'utf-8')));
  });
});
