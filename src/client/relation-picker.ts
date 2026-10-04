/**
 * Relation-picker island — progressive enhancement for `relation` field
 * widgets. The server renders the linked documents as titled chips, the id
 * `<input>` (with `data-bind`), a chip `<template>`, and a hidden search box;
 * this island:
 *
 *   1. hides the id input (it stays the form-value carrier, DATASTAR_PATTERNS
 *      §g) and reveals the search box + each chip's remove button,
 *   2. loads matches for the typed title via plain `fetch` + `innerHTML` from
 *      the server-rendered fragment (`/admin/c/:collection/picker?q=`),
 *   3. runs the combobox keyboard model (arrows, Enter, Escape, Backspace),
 *   4. on pick/remove rewrites the carrier's comma-joined ids and dispatches a
 *      bubbling `input` event so the Datastar signal updates.
 *
 * No JS ⇒ the field still works: the chips show what is linked and the id
 * input is editable.
 */

const DEBOUNCE_MS = 150;

function mount(wrapper: HTMLElement): void {
  if (wrapper.dataset.relationMounted) return;
  const carrier = wrapper.querySelector<HTMLInputElement>('input[data-bind]');
  const chips = wrapper.querySelector<HTMLElement>('[data-relation-chips]');
  const template = wrapper.querySelector<HTMLTemplateElement>('[data-relation-chip-template]');
  const searchWrap = wrapper.querySelector<HTMLElement>('[data-relation-search]');
  const search = searchWrap?.querySelector<HTMLInputElement>('input[role=combobox]');
  const results = wrapper.querySelector<HTMLElement>('[data-relation-results]');
  const status = wrapper.querySelector<HTMLElement>('[data-relation-status]');
  const collection = wrapper.dataset.collection;
  if (!carrier || !chips || !template || !searchWrap || !search || !results || !collection) return;
  wrapper.dataset.relationMounted = '1';
  const multiple = wrapper.dataset.multiple === 'true';

  // ── Take over from the id input ───────────────────────────────────────────
  // Replace the class list (not add): the control's own `w-full` outranks
  // sr-only's width and would leave a page-wide invisible box.
  carrier.className = 'sr-only';
  carrier.setAttribute('tabindex', '-1');
  carrier.setAttribute('aria-hidden', 'true');
  searchWrap.classList.remove('hidden');
  const label = document.querySelector<HTMLLabelElement>(`label[for="${carrier.id}"]`);
  if (label) label.htmlFor = search.id;
  const describedBy = carrier.getAttribute('aria-describedby');
  if (describedBy) search.setAttribute('aria-describedby', describedBy);

  const revealRemove = (chip: Element): void => {
    chip.querySelector('[data-relation-remove]')?.classList.replace('hidden', 'inline-flex');
  };
  chips.querySelectorAll('li').forEach(revealRemove);

  const ids = (): string[] =>
    Array.from(chips.querySelectorAll<HTMLElement>('li[data-id]'), (li) => li.dataset.id ?? '').filter(Boolean);

  const sync = (): void => {
    carrier.value = ids().join(', ');
    // §g: the carrier is the Datastar source of truth — this updates the signal.
    carrier.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const announce = (message: string): void => {
    if (status) status.textContent = message;
  };

  // ── Dropdown ──────────────────────────────────────────────────────────────
  let active = -1;
  let request = 0;
  let timer: number | undefined;

  const options = (): HTMLElement[] =>
    Array.from(results.querySelectorAll<HTMLElement>('[role=option]:not(.hidden)'));

  const setActive = (index: number): void => {
    const opts = options();
    active = opts.length ? (index + opts.length) % opts.length : -1;
    opts.forEach((o, i) => o.setAttribute('aria-selected', i === active ? 'true' : 'false'));
    const current = opts[active];
    if (current) {
      search.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView({ block: 'nearest' });
    } else {
      search.removeAttribute('aria-activedescendant');
    }
  };

  const close = (): void => {
    results.classList.add('hidden');
    search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
    active = -1;
  };

  /** Hide what is already linked; show the empty row when nothing is left. */
  const filterLinked = (): void => {
    const linked = new Set(ids());
    let visible = 0;
    results.querySelectorAll<HTMLElement>('[role=option]').forEach((o, i) => {
      // Fragment options carry no id; one per picker keeps activedescendant unique.
      o.id = `${search.id}-opt-${i}`;
      const taken = linked.has(o.dataset.id ?? '');
      o.classList.toggle('hidden', taken);
      o.classList.toggle('flex', !taken);
      if (!taken) visible++;
    });
    const empty = results.querySelector<HTMLElement>('[data-relation-empty]');
    if (!empty) return;
    empty.classList.toggle('hidden', visible > 0);
    // Matches exist but are all linked already — say that, not "no match".
    if (visible === 0 && linked.size && results.querySelector('[role=option]')) {
      empty.textContent = 'Already linked.';
    }
  };

  const load = async (): Promise<void> => {
    const mine = ++request;
    results.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch(`/admin/c/${encodeURIComponent(collection)}/picker?q=${encodeURIComponent(search.value.trim())}`, {
        headers: { Accept: 'text/html' },
      });
      if (mine !== request) return; // a newer keystroke superseded this one
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      results.innerHTML = await res.text();
      filterLinked();
    } catch (e) {
      if (mine !== request) return;
      const p = document.createElement('p');
      p.setAttribute('role', 'alert');
      p.className = 'px-2.5 py-2 text-sm text-danger';
      p.textContent = e instanceof Error ? e.message : 'Search failed.';
      results.replaceChildren(p);
    } finally {
      if (mine === request) results.removeAttribute('aria-busy');
    }
    results.classList.remove('hidden');
    search.setAttribute('aria-expanded', 'true');
    setActive(search.value.trim() ? 0 : -1);
  };

  const pick = (option: HTMLElement): void => {
    const id = option.dataset.id;
    const title = option.dataset.title ?? id;
    if (!id || !title) return;
    const chip = template.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
    if (!chip) return;
    chip.dataset.id = id;
    const link = chip.querySelector<HTMLAnchorElement>('[data-relation-title]');
    if (link) {
      link.textContent = title;
      link.href = `/admin/c/${collection}/${id}`;
      link.classList.remove('font-mono', 'text-xs');
    }
    chip.querySelector('[data-relation-remove]')?.setAttribute('aria-label', `Remove ${title}`);
    revealRemove(chip);
    if (!multiple) chips.replaceChildren();
    chips.append(chip);
    sync();
    announce(`Linked ${title}`);
    search.value = '';
    close();
  };

  search.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void load(), DEBOUNCE_MS);
  });
  // Open on click, typing, or ArrowDown — not on focus, so tabbing through the
  // form doesn't drop a list over the next field.
  search.addEventListener('click', () => void load());
  search.addEventListener('blur', close);

  search.addEventListener('keydown', (evt) => {
    const open = !results.classList.contains('hidden');
    if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
      evt.preventDefault();
      if (!open) void load();
      else setActive(active + (evt.key === 'ArrowDown' ? 1 : -1));
    } else if (evt.key === 'Enter') {
      // ALWAYS swallow Enter: this input sits inside #editor-form, and a bare
      // Enter would submit the whole document.
      evt.preventDefault();
      const current = options()[active];
      if (open && current) pick(current);
    } else if (evt.key === 'Escape' && open) {
      evt.stopPropagation();
      close();
    } else if (evt.key === 'Backspace' && search.value === '' && multiple) {
      const last = chips.querySelector<HTMLElement>('li[data-id]:last-of-type');
      if (last) {
        announce(`Removed ${last.querySelector('[data-relation-title]')?.textContent ?? 'link'}`);
        last.remove();
        sync();
      }
    }
  });

  // mousedown (not click) + preventDefault keeps focus in the search box, so
  // the blur handler doesn't close the list before the pick lands.
  results.addEventListener('mousedown', (evt) => {
    evt.preventDefault();
    const option = (evt.target as HTMLElement).closest<HTMLElement>('[role=option]');
    if (option) pick(option);
  });

  chips.addEventListener('click', (evt) => {
    const button = (evt.target as HTMLElement).closest('[data-relation-remove]');
    const chip = button?.closest<HTMLElement>('li[data-id]');
    if (!chip) return;
    announce(`Removed ${chip.querySelector('[data-relation-title]')?.textContent ?? 'link'}`);
    chip.remove();
    sync();
    search.focus();
  });
}

for (const el of document.querySelectorAll<HTMLElement>('[data-relation-picker]')) mount(el);

export {};
