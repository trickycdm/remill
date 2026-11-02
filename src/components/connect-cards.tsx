/**
 * Connect-flow components (D48): `SecretReveal` — the one-time plaintext
 * secret with a copy button (extracted from the tokens.tsx idiom so every
 * reveal surface shares it) — and `ConnectCards` — tabbed per-client MCP setup
 * snippets. Both are pure Datastar (per-instance signal names, no islands);
 * secrets/URLs are interpolated into JSX text and copied via `textContent`,
 * never concatenated into user-influenced expressions (DATASTAR_PATTERNS §g,
 * SECURITY_STANDARDS §7 — every dynamic value in a `data-on` here is a
 * server-owned id or closed-vocabulary key).
 */

import { jsonForScript } from '@/lib/json-for-script';
import type { ConnectSnippet } from '@/lib/connect-snippets';
import { Button } from '@/components/ui';

function CopyButton({ sourceId, signal, label }: { sourceId: string; signal: string; label: string }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-label={label}
      data-on:click={`navigator.clipboard.writeText(document.getElementById('${sourceId}').textContent.trim()); $${signal} = true`}
    >
      <span data-show={`!$${signal}`}>Copy</span>
      <span data-show={`$${signal}`} style="display:none">
        Copied!
      </span>
    </Button>
  );
}

/**
 * One-time secret reveal: heading, warning line, the plaintext in a scrollable
 * <code>, and Copy/Copied!. `id` must be unique per page (it namespaces both
 * the code element and the copied-signal).
 */
export function SecretReveal({
  id,
  label,
  note,
  value,
}: {
  id: string;
  label: string;
  note: string;
  value: string;
}) {
  const sig = id.replace(/[^a-zA-Z0-9]/g, '');
  const codeId = `${id}-code`;
  const copied = `copied${sig}`;
  return (
    <div
      class="rounded-md border border-accent/40 bg-accent/5 p-4"
      data-signals={jsonForScript({ [copied]: false })}
    >
      <p class="text-sm font-medium text-ink">{label}</p>
      <p class="mt-0.5 mb-3 text-[13px] text-ink-muted">{note}</p>
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code
          id={codeId}
          class="min-w-0 flex-1 overflow-x-auto rounded-md bg-hover px-3 py-2 font-mono text-sm break-all"
        >
          {value}
        </code>
        <CopyButton sourceId={codeId} signal={copied} label={`Copy ${label.toLowerCase()} to clipboard`} />
      </div>
    </div>
  );
}

function SnippetPanel({
  snippet,
  id,
  tabSignal,
  visible,
}: {
  snippet: ConnectSnippet;
  id: string;
  tabSignal: string;
  visible: boolean;
}) {
  const codeId = `${id}-snip-${snippet.key}`;
  const copied = `${tabSignal}Copied${snippet.key.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <div
      data-show={`$${tabSignal} === '${snippet.key}'`}
      style={visible ? undefined : 'display:none'}
      class="flex flex-col gap-3 rounded-md border border-border bg-surface p-4"
      data-signals={jsonForScript({ [copied]: false })}
    >
      <p class="text-sm text-ink-muted">{snippet.intro}</p>
      {snippet.steps ? (
        <ol class="flex list-decimal flex-col gap-1 pl-5 text-sm text-ink">
          {snippet.steps.map((step) => (
            <li>{step}</li>
          ))}
        </ol>
      ) : null}
      {snippet.deepLink ? (
        <div>
          <Button href={snippet.deepLink.href} variant="primary" size="sm">
            {snippet.deepLink.label}
          </Button>
        </div>
      ) : null}
      {snippet.fallback ? <p class="text-sm text-ink-muted">{snippet.fallback.intro}</p> : null}
      <div class="flex flex-col gap-2">
        <pre
          tabindex={0}
          role="region"
          aria-label={`${snippet.label} setup snippet`}
          class="overflow-x-auto rounded-md bg-hover px-3 py-2"
        >
          <code id={codeId} class="font-mono text-[13px] leading-relaxed">
            {snippet.fallback?.code ?? snippet.code}
          </code>
        </pre>
        <div>
          <CopyButton sourceId={codeId} signal={copied} label={`Copy ${snippet.label} snippet`} />
        </div>
      </div>
      {snippet.caution ? <p class="text-xs text-ink-subtle">{snippet.caution}</p> : null}
    </div>
  );
}

/**
 * Tabbed per-client setup cards. Tabs are a visually-segmented radio group
 * (natively keyboard-accessible) bound to a per-instance tab signal; panels
 * toggle via `data-show`. `initial` picks the fronted card (the wizard maps
 * the client select onto it). `id` namespaces the signals, radio group and
 * code ids, so the token cards (admin wizard) and the URL-only cards (public
 * homepage) are one component.
 */
export function ConnectCards({
  snippets,
  initial,
  id = 'connect',
  legend = 'Setup instructions for your client',
  note,
}: {
  snippets: readonly ConnectSnippet[];
  initial?: string;
  id?: string;
  legend?: string;
  note?: unknown;
}) {
  const tabSignal = `${id.replace(/[^a-zA-Z0-9]/g, '')}Tab`;
  const initialKey = snippets.some((s) => s.key === initial) ? initial! : snippets[0].key;
  return (
    <div class="flex flex-col gap-3" data-signals={jsonForScript({ [tabSignal]: initialKey })}>
      <fieldset>
        <legend class="sr-only">{legend}</legend>
        <div class="inline-flex flex-wrap gap-1 rounded-md border border-border bg-canvas p-1">
          {snippets.map((s) => (
            <label class="cursor-pointer">
              <input
                type="radio"
                name={`${id}-tab`}
                value={s.key}
                class="peer sr-only"
                checked={s.key === initialKey}
                data-bind={tabSignal}
              />
              <span class="inline-flex h-8 items-center rounded px-3 text-sm font-medium text-ink-muted peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-xs peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
                {s.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {snippets.map((s) => (
        <SnippetPanel snippet={s} id={id} tabSignal={tabSignal} visible={s.key === initialKey} />
      ))}
      {note ? <p class="text-xs text-ink-subtle">{note}</p> : null}
    </div>
  );
}
