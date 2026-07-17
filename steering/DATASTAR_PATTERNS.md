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

**Gotcha — signal names derived from data must be sanitized to identifier form.** A hyphen in a
signal name parses as SUBTRACTION (`$busy_prompt-library` → `$busy_prompt - library`), and the
failure is silent: the expression never resolves, so a `data-attr:disabled` bound to it leaves the
server-rendered attribute in place — the Marketplace install button shipped permanently disabled
when the first hyphenated pack key landed (2026-07-17). Any signal name built from a data key
(pack keys, slugs, field keys) must be sanitized (`key.replace(/-/g, '_')`) at the point of
construction. (Related: nanoid ids can't be signal names at all — see worked example 3.)

**Gotcha — a `data-computed` that reads another `data-computed` silently freezes.** A derived signal
referencing only *base* signals updates correctly, but one referencing another computed signal freezes
at its initial value when inputs change. **Inline the whole chain off the base signals** in each
computed you actually display. Keep intermediate computeds only for their own displays (they read base
signals and do react).

**Gotcha — an EMPTY bound `<input type="number">` submits `0`, not undefined.** Number signals
initialize to `0`, so "the user never touched this field" and "the user typed 0" are
indistinguishable in the stored data — an unset `defaultPageSize` persisted as `0` and every list
page silently clamped to one-row pages. Guard at the READ seam: treat out-of-domain numerics as
unset (`getSettings` treats `defaultPageSize < 1` as undefined — the precedent).

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

**Gotcha — `data-class:X` toggles a class; it does NOT guarantee X has CSS behind it, or that X wins.**
Two ways this shipped broken on the homepage tabs (found only by computed-style assertion):
(1) Tailwind emits a utility **only if the literal class appears somewhere as a class value** — a token
that exists solely inside a `data-class:` attribute *name* generates **no rule** (`border-accent` had no
CSS at all). (2) Even a real utility loses same-property conflicts by **stylesheet declaration order**,
not class-string order — a toggled `text-ink` never beats an always-present `text-ink-muted` (declared
later). For state-driven styling, prefer keying CSS off the state attribute you already bind — e.g. a
scoped `<style>` on `[aria-selected=true]` (AdminShell `#rm-sidebar` precedent). Two traps there: Hono
JSX **HTML-escapes quotes inside `<style>`** (use unquoted CSS idents: `[aria-selected=true]`), and when
you must stack same-property utilities (focus rings on the accent band), check the **compiled** CSS
order in `dist/` — never assume the last class in the string wins. E2E: assert `getComputedStyle`, not
markup, for any state-styling that has shipped broken once.

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
| Markdown editing | island — CodeMirror 6 (`src/client/markdown-editor.ts`, D38) |
| Media browsing/upload in the editor | island — media picker (`src/client/media-picker.ts`, D38 — supersedes D12/Uppy) |
| Slow server-rendered section behind a skeleton | island — lazy-fragment (below) |

**Gotcha — `@get` on a load-fragment can loop into a full-page reload.** Using Datastar's
`data-init="@get(...)"` to lazily load a slow section re-fired endlessly (the morph never stripped
`data-init`), and an SSE response made it a full-page reload loop. For one-shot lazy sections use a
**plain `fetch` + `innerHTML` island** that removes its own `data-lazy-src` up front so it can never
fetch twice; Datastar's MutationObserver still wires up reactive attributes in the injected markup.

**Worked example 1 — CodeMirror sync (the island↔form handoff done right).** The `markdown`
widget's `<Textarea data-bind={signal}>` STAYS in the DOM as the form/signal carrier; the island
mounts CodeMirror beside it, then on every doc change writes `textarea.value = doc.toString()` and
dispatches `new Event('input', {bubbles: true})` — Datastar's binding listens for native `input`,
so the signal (and the whole-form `@post`) work unchanged, and no-JS degrades to the plain
textarea. Hide the carrier with `sr-only` + `tabindex="-1"` + `aria-hidden` (NEVER `display:none`
— a label click still forwards focus into the editor), and give the CM content an `aria-label`
threaded via a `data-label` attribute. Theme maps `var(--color-*)` tokens directly — they are
`light-dark()` values, so dark mode needs no JS branching. **Test impact:** the field now exposes
TWO label-associated nodes; e2e must fill via `fillMarkdown` (e2e/helpers/editor.ts), never
`getByLabel`.

**Worked example 2 — the media picker (dialog + fetched fragment).** The widget renders the id
input (data-bind), a JS-only "Browse…" button (hidden until the island mounts), and an EMPTY
`<Dialog>` shell. On open, the island `fetch`es the server-rendered fragment
(`GET /admin/media/picker`) and `innerHTML`s it into the dialog body — per the gotcha above,
NEVER `@get`. Two hard constraints because the dialog sits INSIDE `#editor-form`: the fragment
must contain **no `<form>`** (the island builds `FormData` from bare inputs for
`POST /admin/media/picker`), and **every fragment button must be `type="button"`** (a bare
`<button>` would submit the editor form). Selection writes the id into the field input +
dispatches bubbling `input` — the same handoff as example 1.

**Worked example 3 — bulk selection is a NATIVE form, not signals (D39).** The selectable list
wraps table + bulk bar in one `<form method="post">`; row checkboxes are `name="ids"
value={doc.id}` (the FORM is the state — nanoid ids make invalid signal names, and the flow must
work without JS); the action buttons are the `op` dispatch (`name="op" value="publish|…"`).
Datastar's only job is the select-all convenience one-liner:
`data-on:change="el.closest('form').querySelectorAll('input[name=ids]').forEach((cb) => { cb.checked = el.checked })"`.
Results come back as a `?bulk=ok:<n>,failed:<m>` query-param flash (`role="status"`), the same
pattern as trash's `?restored=`.

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
