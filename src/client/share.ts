/**
 * Reader-share island — progressive enhancement for the article template's share
 * bar (src/components/share-bar.tsx). The server renders social-link fallbacks
 * (work with no JS) plus a hidden "Copy link" / "Share…" group; this island
 * reveals the JS group, retires the fallbacks, wires the clipboard + Web Share
 * API, and announces "Copied" through an aria-live region. Feature-detected: the
 * native "Share…" button is removed where navigator.share is unavailable (most
 * desktops).
 *
 * Excluded from the server tsconfig (see tsconfig `exclude`) — runs in the browser.
 */

function mount(root: HTMLElement): void {
  const js = root.querySelector<HTMLElement>('[data-share-js]');
  if (!js) return;
  const fallback = root.querySelector<HTMLElement>('[data-share-fallback]');
  const copyBtn = root.querySelector<HTMLButtonElement>('[data-share-copy]');
  const nativeBtn = root.querySelector<HTMLButtonElement>('[data-share-native]');
  const status = root.querySelector<HTMLElement>('[data-share-status]');

  // Reveal the enhanced controls, retire the no-JS fallbacks.
  js.classList.remove('hidden');
  fallback?.classList.add('hidden');

  const say = (msg: string): void => {
    if (!status) return;
    status.textContent = msg;
    window.setTimeout(() => {
      if (status.textContent === msg) status.textContent = '';
    }, 2500);
  };

  copyBtn?.addEventListener('click', async () => {
    const url = copyBtn.getAttribute('data-share-url') ?? location.href;
    try {
      await navigator.clipboard.writeText(url);
      say('Copied');
    } catch {
      say('Press Ctrl/Cmd-C to copy');
    }
  });

  if (nativeBtn) {
    if (typeof navigator.share !== 'function') {
      nativeBtn.remove();
    } else {
      nativeBtn.addEventListener('click', async () => {
        const url = nativeBtn.getAttribute('data-share-url') ?? location.href;
        const title = nativeBtn.getAttribute('data-share-title') ?? document.title;
        try {
          await navigator.share({ title, url });
        } catch {
          /* user cancelled or the share sheet failed — no-op */
        }
      });
    }
  }
}

document.querySelectorAll<HTMLElement>('[data-share]').forEach(mount);

export {};
