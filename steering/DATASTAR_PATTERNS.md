# Datastar Patterns

> **STATUS: IMPLEMENTED.** The mechanism library (`src/lib/datastar-response.ts`,
> `src/lib/json-for-script.ts`) and the Datastar-driven admin are live. This doc is ported from a
> battle-tested Datastar v1 codebase — its gotchas are hard-won; do not relearn them.

The admin has no React runtime, no TanStack Query, no client-side routing. Every page is a fresh server
render; **[Datastar v1](https://data-star.dev) is the sole hypermedia runtime** — declarative `data-*`
attributes on the client, SSE patches from the server.

> **Version note:** Datastar v1.0 broke compatibility with every pre-v1 release. Attribute keys use a
> colon (`data-on:click`, not `data-on-click`); modifiers use `__` (`data-on:input__debounce.300ms`);
> SSE events are `datastar-patch-elements` / `datastar-patch-signals`. If you catch yourself writing
> `hx-*`, `data-on-load`, `merge-fragments`, or `mergeSignals`, stop — that's HTMX or pre-v1 Datastar.

The backend SDK is imported from `@starfederation/datastar-sdk/web` (**the `/web` path is required on
Workers**). The client loads from a **pinned** CDN URL in `src/layouts.tsx` for every page.

---

## (a) Signals, binding, and reactive attributes

Page state lives in **signals**, declared with `data-signals` and referenced as `$name`. Serialise a
server object into the attribute with `jsonForScript` (`src/lib/json-for-script.ts`) — never
hand-concatenate.

```tsx
<div data-signals={jsonForScript({ title: '', dirty: false, busy: false, documentId })}>
  <input data-bind="title" data-attr:disabled="$busy" />
  <button data-show="$dirty && !$busy">Save</button>
</div>
```

| Attribute | Purpose |
|---|---|
| `data-signals={...}` | Declare/seed signals (object form) |
| `data-bind="field"` | Two-way bind an input to `$field` |
| `data-text="$foo"` / `data-show="$open"` | Set text content / show-hide |
| `data-class:font-bold="$x"` / `data-attr:disabled="$busy"` | Toggle a class / set any attribute |
| `data-on:click="@post('/x')"` | Event listener |
| `data-init="@get('/feed')"` | Run on load / when patched in |
| `data-computed:total="$a + $b"` / `data-effect="..."` | Read-only derived signal / run on change |

**Gotcha — colon keys are lowercased by HTML.** A key like `data-bind:intendedRole` or
`data-computed:goalsDone` is lowercased by the HTML parser, breaking the signal name. Use the **value
form** for `data-bind` (`data-bind="intendedRole"`) and a **kebab key** for `data-computed`
(`data-computed:goals-done` → reference as `$goalsDone`).

**Gotcha — a `data-computed` that reads another `data-computed` silently freezes.** A derived signal
referencing only *base* signals updates correctly, but one referencing another computed signal freezes
at its initial value when inputs change. **Inline the whole chain off the base signals** in each
computed you actually display. Keep intermediate computeds only for their own displays (they read base
signals and do react).

**Gotcha — reactive expressions are opaque to the type-checker.** `data-computed`/`data-bind`/
`data-text`/`data-on` expressions are plain strings — neither `type-check` nor unit tests (which assert
server-rendered HTML) catch a broken one. **Playwright is the only safety net** (E2E_TESTING.md): when
you add non-trivial reactivity, drive it in a real browser, change inputs, assert the rendered output.
That is how the computed-from-computed freeze above was caught.

**Gotcha — `data-attr:X` DROPS the attribute when the expression is boolean `false`.** That's right for
boolean attributes (`disabled`, `hidden`). But an ARIA attribute that must **always be present** — e.g.
`aria-expanded` on a disclosure trigger — then has *no* value in its collapsed state. Bind a **string
ternary** and render a static initial value:
`aria-expanded="false" data-attr:aria-expanded="$open ? 'true' : 'false'"`. A **disclosure menu** is the
non-modal counterpart to Dialog: an `$open` signal + a transparent full-screen click-outside catcher
(`data-show="$open" data-on:click="$open=false"`) + the shell's `keydown__window` Escape handler —
`role="menu"` with real focusable `<a>`/`<button>` items in DOM order (see `admin-shell.tsx`). Do **not**
reuse the native-`<dialog>` Dialog/Drawer (modal) for a menu.

---

## (b) Form posts with `data-on:submit` + `@post`

`data-on:submit` automatically prevents the default navigation.

```tsx
<form data-on:submit="!$busy && ($busy = true, @post('/admin/c/posts/save'))">
  <input data-bind="title" data-attr:disabled="$busy" />
  <button type="submit" data-attr:disabled="$busy">Save</button>
</form>
```

- Signals are sent automatically (GET/DELETE: `datastar` query param; else JSON body). Read them
  server-side with `ServerSentEventGenerator.readSignals(c.req.raw)`.
- For a classic HTML form whose fields aren't signals, post the form encoding:
  `@post('/url', {contentType: 'form'})`.
- **Set busy flags optimistically.** `$busy = true` runs *synchronously in the expression* before
  `@post`, disabling controls immediately and closing the double-submit window. The server clears
  `busy` when the turn ends.

---

## (c) Navigation: `dsRedirect` (text/javascript)

Datastar follows 302s into HTML (morphing the current page), so an action that should **navigate**
returns a `text/javascript` body Datastar executes. Use the helper:

```ts
import { dsRedirect } from '@/lib/datastar-response';
return dsRedirect(c, '/admin/c/posts');   // → window.location.href = "/admin/c/posts";
```

Do **not** return a `302` to a Datastar action expecting navigation. `dsRedirect` is also used by the
global `onError` for 401 (→ `/admin/login`) on Datastar admin requests.

---

## (d) Inline fragments: morph-by-id at 200

To update part of the page without navigating, return a `text/html` fragment wrapped in an element with
the **same `id`** as the live target. Datastar morphs it by id (default mode `outer`). **The response
must be 2xx** — Datastar ignores non-2xx patches.

```tsx
// Save validation failure — the page has <div id="save-result"></div>
return c.html(
  <div id="save-result" role="alert" class="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
    Slug must be unique.
  </div>,
  200, // 200 so Datastar applies the patch
);
```

Fetched fragments (e.g. a drawer opened with `@get`) can inject themselves via
`datastar-mode: append` / `datastar-selector: body` response headers.

---

## (e) Surfacing unexpected errors: `dsError`

Because Datastar only applies 2xx responses, a thrown `AppError` returning non-2xx JSON dies silently
and leaves busy state stuck. The global `onError` detects Datastar requests and returns a visible error:

```ts
import { dsError } from '@/lib/datastar-response';
const isDatastar = c.req.header('Datastar-Request') === 'true';
if (isDatastar) return dsError(c, err.friendlyMessage);   // 200 text/javascript; dispatches app-error, falls back to alert
return c.json({ error: err.friendlyMessage, code: err.code }, err.status);
```

`onError` order: **401** → redirect to `/admin/login`; **403** → structured deny (ERROR_HANDLING.md);
**other `AppError` on a Datastar request** → `dsError`; else → structured JSON. See ERROR_HANDLING.md.

---

## (f) SSE patch streaming (save feedback, upload progress)

For progress that arrives over time, stream Datastar patches with the SDK, morphing elements in place
as events arrive. The `pipeAgentStreamToDatastar` helper in `src/lib/datastar-chat-stream.ts` is the
ported reference implementation (reserved for post-v1 AI-assisted authoring); the same primitives drive
upload progress and save feedback:

```ts
return ServerSentEventGenerator.stream(async (sse) => {
  sse.patchElements(rowHtml(doc), { selector: '#doc-list', mode: 'append' });
  sse.patchSignals(JSON.stringify({ busy: false }));
});
```

- `patchElements(html, { selector, mode })` — `mode: 'append'` adds a child; default `outer` morphs the
  top-level element by `id`.
- `patchSignals(JSON.stringify(...))` takes a **JSON string**, not an object.
- On any error path, patch a visible error element **and** clear the busy signal — a non-2xx would
  stick busy state (see (e)).

**Long-lived streams on Workers:** a streamed `Response` keeps the invocation alive (the limit is CPU
time, not wall clock). Cloudflare's proxy kills connections idle ~100s, so for genuinely long streams
send a heartbeat comment (`: keepalive\n\n`) every ~30s and pass `{ keepalive: true, onAbort }`, calling
`sse.close()` yourself. Short one-shot streams simply end and let the client reconnect.

---

## (g) When to reach for a JS island instead

Datastar covers virtually all interactivity declaratively. The only sanctioned client-side TypeScript
islands (`src/client/`, loaded via `<Script src="…" />` in **route** JSX, compiled by Vite) are for
things Datastar genuinely can't express:

| Situation | Use |
|---|---|
| Forms, toggles, tabs, partial swaps, redirects, save feedback | **Datastar** (`data-*`, `@post`/`@get`, SSE) |
| Markdown editing | island — CodeMirror 6 (`src/client/`) |
| Resumable multipart uploads + progress | island — Uppy (`src/client/`) |
| Slow server-rendered section behind a skeleton | island — lazy-fragment (below) |

**Gotcha — `@get` on a load-fragment can loop into a full-page reload.** Using Datastar's
`data-init="@get(...)"` to lazily load a slow section re-fired endlessly (the morph never stripped
`data-init`), and an SSE response made it a full-page reload loop. For one-shot lazy sections use a
**plain `fetch` + `innerHTML` island** that removes its own `data-lazy-src` up front so it can never
fetch twice; Datastar's MutationObserver still wires up reactive attributes in the injected markup.

---

## Script loading

The Datastar client loads once from a pinned CDN URL in `src/layouts.tsx` (module script — CSP allows
it). Vite-compiled islands live in `src/client/` and are included from a **route file**:

```tsx
<Script src="/src/client/markdown-editor.ts" />
```

> `vite-ssr-components` only discovers `<Script>` tags in `src/routes/**` — keep them in route files,
> not shared components.

The **only** sanctioned `dangerouslySetInnerHTML` for JS is `jsonForScript` (`src/lib/json-for-script.ts`),
used for `data-signals` payloads — it escapes for safe inline embedding. Never hand-concatenate
user-controlled values into a `<script>` or a `data-on:*` expression (use a `jsLiteral` helper when
interpolating a name into a `confirm('…')` expression). See SECURITY_STANDARDS.md §7.
