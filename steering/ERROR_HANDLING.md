# Error Handling

> **STATUS: IMPLEMENTED.** The `AppError` hierarchy (`src/lib/errors.ts`) and the global `onError`
> (`src/main.tsx`) are live, including `authorize()`-driven 403s. The rules bind every service and
> route.

## Principles

- **Fail loud, never default.** When an operation fails and the result would drive user-visible
  behaviour (permissions, data visibility, publish state), **throw** — never silently return a
  fallback. A 500 is strictly better than rendering the wrong UI.

  ```ts
  const doc = await getDocumentRow(db, id);
  if (!doc) throw new NotFoundError('Document');   // not: doc?.status ?? 'draft'
  ```

- **Throw, don't format, in routes and services.** They throw typed errors; a single global handler
  is the only place errors become HTTP responses. Routes never catch to re-format.
- **Never leak internals.** Only `friendlyMessage` reaches the client. Stack traces, SQL, schema,
  and constraint names are logged server-side only.
- **Log with structured context before re-throwing.** Metadata object first: `log.error({ documentId,
  err }, 'failed to save document')`.

## The `AppError` hierarchy (`src/lib/errors.ts`)

Every `AppError` carries: `status` (HTTP), `code` (machine-readable), `friendlyMessage` (client-safe),
`message` (internal, logged only), and optional `details` (`{ path?, message }[]` for 422).

```
AppError (base — the one sanctioned class in the codebase)
├── BadRequestError      (400, BAD_REQUEST)        invalid input, constraint violation, bad JSON
├── UnauthorizedError    (401, UNAUTHORIZED)        no/expired session
├── ForbiddenError       (403, FORBIDDEN)           denied by authorize() — see below
├── NotFoundError        (404, NOT_FOUND)           entity doesn't exist
├── InputValidationError (422, VALIDATION_FAILED)   Zod issues in `details`
└── InternalServerError  (500, INTERNAL_ERROR)      friendlyMessage: "Something went wrong — please try again"
```

Throw the class that matches the situation. For Zod, call `validateData(schema, raw)` from
`src/lib/validation.ts` at a **service** entry point — it throws `InputValidationError` with field
paths. Routes parse and hand off; they do not validate.

## Global handler (`src/main.tsx` `app.onError`)

The single place uncaught errors become responses. Resolution order:

1. **401 Unauthorized** → for an **admin** (browser) request, redirect to
   `/admin/login?redirect=<encoded-path>`. Never return a raw JSON 401 to the admin surface.
2. **403 Forbidden** → structured deny (see below). For an admin navigation, redirect to `/admin`.
3. **Other `AppError` on a Datastar request** (`Datastar-Request: true`) → `dsError(c,
   err.friendlyMessage)` — a **200** `text/javascript` body that surfaces the message. Required
   because **Datastar only applies 2xx patches**; a non-2xx JSON body would die silently and leave
   busy/disabled state stuck. See DATASTAR_PATTERNS.md.
4. **All other `AppError`** (REST / MCP callers) → JSON `{ error: friendlyMessage, code }` at the
   error's status.
5. **Unknown errors** → `console.error('[unhandled]', err)`, then a generic 500 (`dsError` for a
   Datastar request, else `{ error: 'Something went wrong — please try again', code: 'INTERNAL_ERROR' }`).

Errors are correlated via Cloudflare Workers Logs (URL + timestamp) — there is no `requestId` field.

## The structured 403 deny shape

Denials from `authorize()` return **`403 { error, code: 'FORBIDDEN', missing: { action, collection } }`**
so an agent can reason about what it lacks instead of retrying blindly. This shape and its semantics
are **defined in ACCESS_CONTROL.md — do not redefine it here.** The three surfaces render it
identically:

- **REST / API** → the JSON object verbatim.
- **MCP** → mapped into the tool error payload (same `code` + `missing`).
- **Admin (Datastar)** → `dsError` with a human sentence; the machine shape is logged and audited.

## Expected vs unexpected errors on the admin surface

- **Expected** business/validation errors a route handles inline → return an HTML **fragment** wrapped
  in the container `id` the form expects (`#login-result`, `#save-result`, …) at **status 200**, so
  Datastar morphs it in. This is normal form feedback, not an exception.
- **Unexpected** thrown `AppError` → let `onError` handle it (`dsError` for Datastar requests). Never
  catch an `AppError` in a route to build a custom response.

See DATASTAR_PATTERNS.md for the full fragment / redirect / in-stream error contract.

## DB errors

Catch D1 constraint errors in **services** and re-throw as typed `AppError` — never let a raw D1
message reach the client:

```ts
try {
  await saveDocument(db, data);
} catch (err) {
  if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
    throw new BadRequestError('A document with this slug already exists');
  }
  log.error({ collection, err }, 'failed to save document');
  throw new InternalServerError('Failed to save document');
}
```

Full D1 error → `AppError` mapping table is in DATABASE_STANDARDS.md §8.

## Verification

For any change: authorization/visibility failures throw rather than default; errors use the typed
hierarchy with distinct client-safe vs internal messages; routes propagate rather than format; no
internal detail leaks; every deny returns the ACCESS_CONTROL.md 403 shape on every surface.
