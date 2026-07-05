/**
 * Card — a quiet surface container with a hairline border and soft shadow.
 * Compose with the header/title/description/content/footer helpers, or drop
 * children straight in. Titles default to <h3>; pass `as` to fit the page's
 * heading hierarchy (A11Y_STANDARDS.md — never a hard-coded h1 inside a card).
 */

export function Card({ children, class: cls }: { children: unknown; class?: string }) {
  return (
    <div
      class={`rounded-lg border border-border bg-surface text-ink shadow-xs${cls ? ` ${cls}` : ''}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, class: cls }: { children: unknown; class?: string }) {
  return <div class={`flex flex-col gap-1 px-5 pt-5${cls ? ` ${cls}` : ''}`}>{children}</div>;
}

export function CardTitle({
  children,
  as: As = 'h3',
  class: cls,
}: {
  children: unknown;
  as?: 'h2' | 'h3' | 'h4';
  class?: string;
}) {
  return (
    <As class={`font-serif text-lg leading-snug font-semibold tracking-tight text-ink${cls ? ` ${cls}` : ''}`}>
      {children}
    </As>
  );
}

export function CardDescription({ children, class: cls }: { children: unknown; class?: string }) {
  return <p class={`text-sm text-ink-muted${cls ? ` ${cls}` : ''}`}>{children}</p>;
}

export function CardContent({ children, class: cls }: { children: unknown; class?: string }) {
  return <div class={`px-5 py-5${cls ? ` ${cls}` : ''}`}>{children}</div>;
}

export function CardFooter({ children, class: cls }: { children: unknown; class?: string }) {
  return (
    <div class={`flex items-center gap-2 border-t border-border px-5 py-4${cls ? ` ${cls}` : ''}`}>
      {children}
    </div>
  );
}
