/**
 * Media-picker island (D38, supersedes D12/Uppy) — progressive enhancement for
 * `media` field widgets. The server renders the id `<input>` (with
 * `data-bind`), a "Browse…" button, and an EMPTY `<dialog>` shell per field;
 * this island:
 *
 *   1. opens/closes the dialog (`showModal()` — native focus trap),
 *   2. loads the server-rendered picker fragment via plain `fetch` +
 *      `innerHTML` (Datastar `@get` is BANNED for load-fragments — it re-fires
 *      and full-page-reloads; see src/lib/datastar-response.ts),
 *   3. uploads via FormData built from BARE inputs in the fragment (the dialog
 *      sits inside #editor-form, so the fragment must never contain a nested
 *      <form>), then auto-selects the new asset,
 *   4. on tile click writes the media id into the field input and dispatches a
 *      bubbling `input` event so the Datastar signal updates (§g handoff).
 *
 * No JS ⇒ the field still works: paste an id, or use the Media library link.
 */

const FRAGMENT_URL = '/admin/media/picker';

function show(el: HTMLElement | null, visible: boolean): void {
  if (el) el.classList.toggle('hidden', !visible);
}

function setError(body: HTMLElement, message: string | null): void {
  const slot = body.querySelector<HTMLElement>('[data-picker-error]');
  if (!slot) return;
  slot.textContent = message ?? '';
  show(slot, message !== null);
}

async function loadFragment(body: HTMLElement, cursor?: string): Promise<void> {
  body.setAttribute('aria-busy', 'true');
  try {
    const url = cursor ? `${FRAGMENT_URL}?cursor=${encodeURIComponent(cursor)}` : FRAGMENT_URL;
    const res = await fetch(url, { headers: { Accept: 'text/html' } });
    if (!res.ok) throw new Error(`Picker failed to load (${res.status})`);
    body.innerHTML = await res.text();
  } catch (e) {
    body.innerHTML = `<p role="alert" class="text-sm text-danger">${e instanceof Error ? e.message : 'Failed to load media.'}</p>`;
  } finally {
    body.removeAttribute('aria-busy');
  }
}

function select(wrapper: HTMLElement, dialog: HTMLDialogElement, id: string): void {
  const input = wrapper.querySelector<HTMLInputElement>('input[data-bind]');
  if (!input) return;
  input.value = id;
  // §g: the input is the Datastar source of truth — this updates the signal.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const preview = wrapper.querySelector<HTMLImageElement>('[data-picker-preview]');
  if (preview) {
    preview.src = `/media/${id}`;
    show(preview, true);
  }
  dialog.close();
}

async function upload(wrapper: HTMLElement, dialog: HTMLDialogElement, body: HTMLElement): Promise<void> {
  const file = body.querySelector<HTMLInputElement>('[data-picker-file]')?.files?.[0];
  const alt = body.querySelector<HTMLInputElement>('[data-picker-alt]')?.value ?? '';
  if (!file) {
    setError(body, 'Choose a file first.');
    return;
  }
  setError(body, null);
  const form = new FormData();
  form.set('file', file);
  form.set('alt', alt);
  body.setAttribute('aria-busy', 'true');
  try {
    const res = await fetch(FRAGMENT_URL, { method: 'POST', body: form });
    const payload = (await res.json()) as { id?: string; error?: string };
    if (!res.ok || !payload.id) throw new Error(payload.error ?? `Upload failed (${res.status})`);
    select(wrapper, dialog, payload.id); // upload-and-use in one gesture
  } catch (e) {
    setError(body, e instanceof Error ? e.message : 'Upload failed.');
  } finally {
    body.removeAttribute('aria-busy');
  }
}

function mount(wrapper: HTMLElement): void {
  if (wrapper.dataset.pickerMounted) return;
  wrapper.dataset.pickerMounted = '1';
  const dialogId = wrapper.dataset.pickerDialog ?? '';
  const dialog = document.getElementById(dialogId) as HTMLDialogElement | null;
  const openBtn = wrapper.querySelector<HTMLButtonElement>('[data-picker-open]');
  const body = dialog?.querySelector<HTMLElement>('[data-picker-body]');
  if (!dialog || !openBtn || !body) return;

  show(openBtn, true); // hidden server-side; only useful with JS

  openBtn.addEventListener('click', () => {
    dialog.showModal();
    void loadFragment(body); // refresh on every open — cheap, always current
  });

  // One delegated listener covers tiles, paging, and upload across reloads.
  body.addEventListener('click', (evt) => {
    const target = (evt.target as HTMLElement).closest<HTMLElement>('[data-media-id], [data-picker-more], [data-picker-upload]');
    if (!target) return;
    if (target.dataset.mediaId) select(wrapper, dialog, target.dataset.mediaId);
    else if (target.dataset.pickerMore !== undefined) void loadFragment(body, target.dataset.cursor);
    else void upload(wrapper, dialog, body);
  });
}

for (const el of document.querySelectorAll<HTMLElement>('[data-media-picker]')) mount(el);

export {};
