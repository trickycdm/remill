/**
 * CodeMirror 6 markdown island (D38, implements D13) — progressive enhancement
 * for `markdown` field widgets. The server renders a plain `<textarea>` (with
 * `data-bind`) inside `[data-md-editor]`; this island replaces it VISUALLY with
 * a CodeMirror editor while the textarea stays in the DOM as the form-value
 * carrier (DATASTAR_PATTERNS §g): every edit writes `textarea.value` and
 * dispatches a bubbling `input` event, so the Datastar signal — and the
 * whole-form `@post` — work exactly as without JS. No JS ⇒ the textarea simply
 * stays visible; nothing breaks.
 *
 * Loaded ONLY from the editor route files (vite-ssr-components discovers
 * <Script> in routes, not shared components). Must tolerate pages without any
 * `[data-md-editor]` target.
 */

import { EditorView, minimalSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';

// Theme maps the design-system tokens (src/tailwind.css @theme). The tokens are
// `light-dark()` CSS custom properties, so dark mode follows `data-theme` on
// <html> with no JS branching here.
const theme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-ink)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: '0.375rem',
    fontSize: '0.875rem',
  },
  '&.cm-focused': { outline: '2px solid var(--color-ring)', outlineOffset: '2px' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.6',
    minHeight: '16rem',
    maxHeight: '42rem',
  },
  '.cm-content': { padding: '0.625rem 0.75rem', caretColor: 'var(--color-ink)' },
  '.cm-cursor': { borderLeftColor: 'var(--color-ink)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--color-accent-soft)',
  },
  '.cm-placeholder': { color: 'var(--color-ink-subtle)' },
});

function mount(wrapper: HTMLElement): void {
  if (wrapper.dataset.mdMounted) return;
  const textarea = wrapper.querySelector('textarea');
  if (!textarea) return;
  wrapper.dataset.mdMounted = '1';

  const view = new EditorView({
    doc: textarea.value,
    parent: wrapper,
    extensions: [
      minimalSetup,
      markdown(),
      EditorView.lineWrapping,
      theme,
      // The editor is the accessible control now; label text threaded from the
      // field descriptor via data-label (the FormField label points at the
      // hidden textarea's id).
      EditorView.contentAttributes.of({ 'aria-label': wrapper.dataset.label ?? 'Markdown editor' }),
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        // §g sync: the textarea stays the form/Datastar source of truth.
        textarea.value = u.state.doc.toString();
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }),
    ],
  });

  // Visually hide the textarea but keep it programmatically present (sr-only,
  // NOT display:none). It leaves the tab order and the accessibility tree —
  // the CodeMirror content role="textbox" replaces it; a label click (for=
  // the textarea id) forwards focus into the editor.
  textarea.classList.add('sr-only');
  textarea.setAttribute('tabindex', '-1');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.addEventListener('focus', () => view.focus());
}

for (const el of document.querySelectorAll<HTMLElement>('[data-md-editor]')) mount(el);

export {};
