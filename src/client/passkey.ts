/**
 * Passkey island (D58) — the browser half of WebAuthn, which Datastar cannot
 * express (it needs `navigator.credentials`). One script, two mount points:
 *
 *   • `[data-passkey-login]` on /admin/login — a "Use a passkey" button,
 *     plus browser autofill on the email box where the browser supports it;
 *   • `[data-passkey-add]` on /admin/account — the "Add a passkey" form.
 *
 * Progressive enhancement: the server renders both hidden; this island reveals
 * them only when the browser can do WebAuthn with the native JSON helpers. The
 * server issues the options and verifies the result — nothing here is trusted.
 * Errors go to the mount's `[data-passkey-status]` live region; dismissing the
 * browser's own prompt is not an error and stays silent.
 *
 * Excluded from the server tsconfig (see tsconfig `exclude`) — runs in the browser.
 */

const GENERIC_ERROR = 'Something went wrong — please reload the page and try again.';

class PasskeyError extends Error {}

function supported(): boolean {
  return (
    typeof window.PublicKeyCredential === 'function' &&
    typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function' &&
    typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function'
  );
}

async function post(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const data = isJson ? ((await res.json()) as Record<string, unknown>) : {};
  if (!res.ok || !isJson) throw new PasskeyError(typeof data.error === 'string' ? data.error : GENERIC_ERROR);
  return data;
}

/** The person dismissed the browser prompt, or we cancelled it ourselves. */
function isCancel(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError');
}

function messageFor(err: unknown): string {
  if (err instanceof PasskeyError) return err.message;
  if (err instanceof DOMException && err.name === 'InvalidStateError') {
    return 'This device already has a passkey for your account.';
  }
  console.error('[passkey]', err);
  return GENERIC_ERROR;
}

function reveal(el: HTMLElement): void {
  el.classList.replace('hidden', 'flex');
}

function mountLogin(root: HTMLElement): void {
  const button = root.querySelector<HTMLButtonElement>('[data-passkey-signin]');
  const status = root.querySelector<HTMLElement>('[data-passkey-status]');
  if (!button || !status) return;
  reveal(root);

  // Autofill ("conditional") and the button share one pending request at a time.
  let pending: AbortController | null = null;

  const signIn = async (mediation?: CredentialMediationRequirement): Promise<void> => {
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    // Until the person actually picks a passkey, the autofill offer is
    // best-effort: failing to set it up is silent (the button still works).
    let credential: Credential | null;
    try {
      const options = await post('/admin/login/passkey/options', {});
      credential = await navigator.credentials.get({
        publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options as never),
        mediation,
        signal: controller.signal,
      });
    } catch (err) {
      if (mediation === 'conditional') return;
      throw err;
    }
    if (!credential) return;
    const done = await post('/admin/login/passkey/verify', {
      response: (credential as PublicKeyCredential).toJSON(),
      redirect: root.dataset.passkeyRedirect ?? '',
    });
    window.location.assign(typeof done.redirect === 'string' ? done.redirect : '/admin');
  };

  button.addEventListener('click', async () => {
    status.textContent = '';
    button.disabled = true;
    try {
      await signIn();
    } catch (err) {
      if (!isCancel(err)) status.textContent = messageFor(err);
    } finally {
      button.disabled = false;
    }
  });

  // Offer saved passkeys in the email box's autofill.
  void PublicKeyCredential.isConditionalMediationAvailable?.()
    .then((available) => (available ? signIn('conditional') : undefined))
    .catch((err: unknown) => {
      if (!isCancel(err)) status.textContent = messageFor(err);
    });
}

function mountAdd(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>('form');
  const status = root.querySelector<HTMLElement>('[data-passkey-status]');
  const submit = root.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!form || !status || !submit) return;
  reveal(root);
  root.parentElement?.querySelector('[data-passkey-unsupported]')?.classList.add('hidden');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    submit.disabled = true;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '');
    try {
      const options = await post('/admin/account/passkeys/options', {
        name,
        currentPassword: String(data.get('currentPassword') ?? ''),
      });
      const credential = await navigator.credentials.create({
        publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options as never),
      });
      if (!credential) return;
      const done = await post('/admin/account/passkeys', {
        name,
        response: (credential as PublicKeyCredential).toJSON(),
      });
      window.location.assign(typeof done.redirect === 'string' ? done.redirect : '/admin/account');
    } catch (err) {
      if (!isCancel(err)) status.textContent = messageFor(err);
    } finally {
      submit.disabled = false;
    }
  });
}

function init(): void {
  if (!supported()) return;
  document.querySelectorAll<HTMLElement>('[data-passkey-login]').forEach(mountLogin);
  document.querySelectorAll<HTMLElement>('[data-passkey-add]').forEach(mountAdd);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
