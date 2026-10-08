/**
 * InlinePage — an inline-mode document (D63) rendered in place: the `.rm-page`
 * wrapper standing in for the document's body, the base sheet, then the
 * prepared document (`prepareInlineDocument`) VERBATIM — the trusted-author
 * exception (D25), scripts included.
 *
 * The wrapper's markers:
 *  - `data-ignore` — Datastar never processes the author's markup, so a
 *    `data-on:*`-shaped attribute in a page is inert (the subtree is skipped,
 *    including nodes the page's own scripts add later).
 *  - `data-rm-annotatable` + `data-rm-field` — the review island's region
 *    (D55), the same contract `FieldView` gives shell-mode fields; the server's
 *    canonical text reads the page field with the `document` profile.
 *
 * Public-safe: no admin-shell import, no data fetching.
 */

import type { InlineDocument } from '@/lib/inline/document';
import { PAGE_BASE_CSS, PAGE_SCOPE } from '@/lib/inline/css';

export function InlinePage({ page, field }: { page: InlineDocument; field: string }) {
  const { attrs } = page;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PAGE_BASE_CSS }} />
      <div
        class={attrs.class ? `${PAGE_SCOPE.slice(1)} ${attrs.class}` : PAGE_SCOPE.slice(1)}
        style={attrs.style}
        lang={attrs.lang}
        dir={attrs.dir}
        data-ignore
        data-rm-annotatable
        data-rm-field={field}
        dangerouslySetInnerHTML={{ __html: page.html }}
      />
    </>
  );
}
