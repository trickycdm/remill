/**
 * ThemeToggle — flips `<html data-theme>` and persists the choice to
 * localStorage ('remill-theme'); tailwind.css resolves every token from
 * `color-scheme` via light-dark(), so nothing else needs to change. Owns its
 * own `theme` signal, seeded from the resolved DOM theme on init so the icon
 * and label are right from the first paint. Pair it with `THEME_INIT_SNIPPET`
 * in the document head (RootLayout does) so a stored theme applies flash-free.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { Sun, Moon } from '@/components/ui/icon';

export function ThemeToggle(): JSX.Element {
  return (
    <span
      class="contents"
      data-signals="{theme: 'light'}"
      data-init="$theme = document.documentElement.getAttribute('data-theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')"
    >
      <button
        type="button"
        aria-label="Toggle color theme"
        data-attr:aria-label="$theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
        data-on:click="$theme = $theme === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', $theme); localStorage.setItem('remill-theme', $theme)"
        class="flex size-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span class="contents" data-show="$theme === 'dark'" style="display:none">
          <Sun class="size-5" />
        </span>
        <span class="contents" data-show="$theme !== 'dark'">
          <Moon class="size-5" />
        </span>
      </button>
    </span>
  );
}
