import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { apiJson } from '@/lib/api';
import { listTemplates } from '@/templates/registry';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/templates — the reading-template registry (discovery; registry
 *  metadata is code, so this is ungated like collection discovery). */
export const onRequestGet = factory.createHandlers(async (c) => {
  return apiJson(c, { data: listTemplates() });
});
