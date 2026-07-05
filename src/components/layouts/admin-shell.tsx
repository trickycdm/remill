/**
 * AdminShell — the authenticated admin layout: a full-height sidebar <Nav>, a
 * sticky top bar (mobile wordmark + hamburger, theme toggle, user + sign-out),
 * and the page's single <main> content region.
 *
 * Accessibility: skip link → #main-content, a <nav> landmark with aria-current on
 * the active item (Nav), aria-expanded/aria-controls on the mobile menu button,
 * Escape closes the mobile drawer, and a live <ToastHost> for app-error events.
 *
 * Responsiveness: the sidebar is fixed and always visible from md up; below md it
 * slides in as an overlay toggled by a Datastar `navOpen` signal (+ backdrop).
 *
 * Theme: the toggle flips <html data-theme> and persists to localStorage
 * ('remill-theme'); tailwind.css resolves every token from `color-scheme` via
 * light-dark(), so no per-token class flipping is needed. The `theme` signal is
 * seeded from the resolved DOM theme on init so the icon/label stay correct.
 *
 * The layout owner (src/layouts.tsx) must render THEME_INIT_SNIPPET in <head>
 * (see its doc below) so a stored theme is applied before first paint.
 */

import {
  Nav,
  type NavItem,
  Badge,
  ToastHost,
  Dashboard,
  FileText,
  Image,
  Boxes,
  ShieldCheck,
  Settings,
  Menu,
  Sun,
  Moon,
  LogOut,
  ChevronDown,
} from '@/components/ui';
import { Wordmark } from '@/components/auth-shell';

/**
 * No-flash theme init. A static, self-contained IIFE — the layout owner renders
 * it in <head> as the FIRST script, before the stylesheet paints:
 *   <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SNIPPET }} />
 * If no theme is stored, nothing is set and the OS preference applies via
 * `color-scheme: light dark` (also flash-free). The value is static, so a plain
 * string is correct here — jsonForScript is only for embedding dynamic data.
 */
export const THEME_INIT_SNIPPET =
  "(function(){try{var t=localStorage.getItem('remill-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();";

/** The admin sidebar destinations (plan §5a). */
const NAV_ITEMS: readonly NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/admin', icon: Dashboard },
  { key: 'content', label: 'Content', href: '/admin/c', icon: FileText },
  { key: 'media', label: 'Media', href: '/admin/media', icon: Image },
  { key: 'collections', label: 'Collections', href: '/admin/collections', icon: Boxes },
  { key: 'access', label: 'Access', href: '/admin/access', icon: ShieldCheck },
  { key: 'settings', label: 'Settings', href: '/admin/settings', icon: Settings },
];

/**
 * Which nav items a coarse role may see — the UI-hiding half of permission-aware
 * navigation (server-side authorize() is the real enforcement). Managing schema
 * (Collections) and access (Access) are admin-only; anyone who can read sees
 * Content/Media/Dashboard. Unknown/custom roles fall back to the reader set.
 */
const NAV_BY_ROLE: Record<string, readonly string[]> = {
  admin: ['dashboard', 'content', 'media', 'collections', 'access', 'settings'],
  editor: ['dashboard', 'content', 'media', 'settings'],
  author: ['dashboard', 'content', 'media'],
  reader: ['dashboard', 'content', 'media'],
};

function visibleNav(role: string): readonly NavItem[] {
  const allowed = NAV_BY_ROLE[role] ?? NAV_BY_ROLE.reader;
  return NAV_ITEMS.filter((i) => allowed.includes(i.key));
}

interface AdminUser {
  readonly displayName: string;
  readonly email: string;
  readonly role: string;
}

export function AdminShell({
  user,
  current,
  children,
}: {
  user: AdminUser;
  /** The active NavItem key (e.g. 'content'). */
  current: string;
  children: unknown;
}) {
  // `|| email` (not ??) so an empty displayName falls back to the email.
  const name = user.displayName || user.email;
  return (
    <div
      class="min-h-dvh bg-canvas text-ink"
      data-signals="{navOpen: false, userMenuOpen: false, theme: 'light'}"
      data-init="$theme = document.documentElement.getAttribute('data-theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')"
      data-on:keydown__window="evt.key === 'Escape' && ($navOpen = false, $userMenuOpen = false)"
    >
      {/* Mobile drawer mechanics — scoped, robust, no Tailwind transform conflicts.
          Plain CSS (no <, >, & chars) so JSX text escaping is a no-op. */}
      <style>
        {'#rm-sidebar{transform:translateX(-100%);transition:transform .22s cubic-bezier(.22,1,.36,1);}' +
          '#rm-sidebar.rm-nav-open{transform:translateX(0);}' +
          '@media (min-width:768px){#rm-sidebar{transform:translateX(0)!important;}}'}
      </style>

      <a
        href="#main-content"
        class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-md focus:outline-2 focus:outline-offset-2 focus:outline-ring"
      >
        Skip to content
      </a>

      {/* ── Sidebar (fixed; overlay drawer below md) ─────────────────────────── */}
      <aside
        id="rm-sidebar"
        data-class:rm-nav-open="$navOpen"
        class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-surface"
      >
        <div class="flex h-16 shrink-0 items-center border-b border-border px-5">
          <a href="/admin" aria-label="remill home" class="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <Wordmark />
          </a>
        </div>
        <div class="flex-1 overflow-y-auto p-3">
          <Nav items={visibleNav(user.role)} current={current} ariaLabel="Admin sections" />
        </div>
        <div class="shrink-0 border-t border-border px-5 py-4">
          <span class="font-mono text-eyebrow font-medium tracking-[0.14em] text-ink-subtle uppercase">
            remill · CMS
          </span>
        </div>
      </aside>

      {/* Backdrop for the mobile drawer. */}
      <div
        data-show="$navOpen"
        style="display:none"
        data-on:click="$navOpen = false"
        aria-hidden="true"
        class="fixed inset-0 z-30 bg-overlay md:hidden"
      />

      {/* ── Content column ──────────────────────────────────────────────────── */}
      <div class="flex min-h-dvh flex-col md:pl-64">
        <header class="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-surface/85 px-4 backdrop-blur-md">
          <button
            type="button"
            aria-label="Open navigation menu"
            aria-controls="rm-sidebar"
            data-attr:aria-expanded="$navOpen"
            data-on:click="$navOpen = !$navOpen"
            class="flex size-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:hidden"
          >
            <Menu class="size-5" />
          </button>

          <a href="/admin" aria-label="remill home" class="rounded-md md:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <Wordmark class="text-xl" />
          </a>

          <div class="flex-1" />

          {/* Theme toggle — flips <html data-theme> + persists; icon tracks $theme. */}
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

          <div aria-hidden="true" class="mx-1 h-6 w-px bg-border" />

          {/* User menu — a Datastar disclosure (not a modal): the trigger is the
              user's name + chevron; the panel holds account + sign-out. Reuses the
              shell's click-outside-backdrop + window-Escape idioms. Logout stays a
              native form POST (the route redirects via dsRedirect). */}
          <div class="relative">
            <button
              type="button"
              id="rm-user-menu-trigger"
              aria-haspopup="menu"
              aria-controls="rm-user-menu"
              aria-expanded="false"
              data-attr:aria-expanded="$userMenuOpen ? 'true' : 'false'"
              data-on:click="$userMenuOpen = !$userMenuOpen"
              class="flex h-9 items-center gap-2 rounded-md px-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span class="max-w-[10rem] truncate text-ink">{name}</span>
              <ChevronDown class="size-4 shrink-0 transition-transform" data-class:rotate-180="$userMenuOpen" />
            </button>

            {/* Click-outside catcher — transparent (a menu shouldn't dim the page). */}
            <div
              data-show="$userMenuOpen"
              style="display:none"
              data-on:click="$userMenuOpen = false"
              aria-hidden="true"
              class="fixed inset-0 z-30"
            />

            {/* Panel */}
            <div
              id="rm-user-menu"
              role="menu"
              aria-labelledby="rm-user-menu-trigger"
              data-show="$userMenuOpen"
              style="display:none"
              class="rm-anim-rise absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg"
            >
              <div class="border-b border-border px-4 py-3">
                <p class="truncate text-sm font-medium text-ink">{name}</p>
                <p class="truncate font-mono text-xs text-ink-subtle">{user.email}</p>
                <Badge tone="neutral" class="mt-1.5 capitalize">
                  {user.role}
                </Badge>
              </div>
              <div class="p-1">
                <a
                  href="/admin/account"
                  role="menuitem"
                  class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Settings class="size-[18px]" />
                  Account settings
                </a>
                <form method="post" action="/admin/logout" class="contents">
                  <button
                    type="submit"
                    role="menuitem"
                    class="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <LogOut class="size-[18px]" />
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          </div>
        </header>

        <main id="main-content" class="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>

      {/* One live toast host for the whole admin (catches app-error events). */}
      <ToastHost />
    </div>
  );
}
