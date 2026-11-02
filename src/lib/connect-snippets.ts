/**
 * Per-client MCP connection artifacts (D48): pure builders behind both
 * `ConnectCards` surfaces — the admin connect wizard (token snippets, the
 * mill's real origin) and the public homepage quickstart (URL-only OAuth
 * snippets on `MILL_URL_PLACEHOLDER`, since a visitor connects their OWN mill). Values are interpolated
 * into JSX TEXT (or copied via textContent) — never into Datastar expressions.
 */

export interface ConnectSnippet {
  /** Tab identity + Datastar signal value (closed vocabulary, server-owned). */
  readonly key: string;
  /** Tab label. */
  readonly label: string;
  /** One-line instruction above the code block. */
  readonly intro: string;
  /** Ordered steps shown under the intro, for clients set up in their own UI. */
  readonly steps?: readonly string[];
  /** The paste-ready artifact. */
  readonly code: string;
  /** Optional one-click install link (deep-link clients). */
  readonly deepLink?: { readonly href: string; readonly label: string };
  /** Secondary artifact shown under the deep link (config-file fallback). */
  readonly fallback?: { readonly intro: string; readonly code: string };
  /** Muted caution line (e.g. deep links embed the token). */
  readonly caution?: string;
}

/** Stands in for a mill's origin wherever instructions are not about the
 *  instance serving them (the public homepage): remill is self-hosted, so the
 *  reader connects THEIR mill, never the one they are reading. */
export const MILL_URL_PLACEHOLDER = 'https://<your-mill>';

/** The `.mcp.json` shape — kept byte-identical between wizard and homepage. */
export function mcpJsonConfig(baseUrl: string, token: string): string {
  return `{
  "mcpServers": {
    "remill": {
      "type": "http",
      "url": "${baseUrl}/mcp",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}`;
}

function cursorConfig(baseUrl: string, token: string): string {
  return `{
  "mcpServers": {
    "remill": {
      "url": "${baseUrl}/mcp",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}`;
}

function cursorDeepLink(baseUrl: string, token: string): string {
  const config = JSON.stringify({
    url: `${baseUrl}/mcp`,
    headers: { Authorization: `Bearer ${token}` },
  });
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=remill&config=${btoa(config)}`;
}

function vscodeDeepLink(baseUrl: string, token: string): string {
  const config = JSON.stringify({
    name: 'remill',
    type: 'http',
    url: `${baseUrl}/mcp`,
    headers: { Authorization: `Bearer ${token}` },
  });
  return `vscode:mcp/install?${encodeURIComponent(config)}`;
}

const DEEP_LINK_CAUTION = 'The install link embeds your token — on a shared machine, prefer the config file.';

/** All connect cards, in display order. */
export function connectSnippets(baseUrl: string, token: string): ConnectSnippet[] {
  const vscodeConfig = JSON.stringify({
    name: 'remill',
    type: 'http',
    url: `${baseUrl}/mcp`,
    headers: { Authorization: `Bearer ${token}` },
  });
  return [
    {
      key: 'claude-code',
      label: 'Claude Code',
      intro: 'Run this in your terminal, then restart Claude Code.',
      code: `claude mcp add --transport http remill ${baseUrl}/mcp --header "Authorization: Bearer ${token}"`,
    },
    {
      key: 'mcp-json',
      label: '.mcp.json',
      intro: 'For project-scoped Claude Code, or any client that reads .mcp.json.',
      code: mcpJsonConfig(baseUrl, token),
    },
    {
      key: 'cursor',
      label: 'Cursor',
      intro: 'One click installs the server in Cursor.',
      code: cursorConfig(baseUrl, token),
      deepLink: { href: cursorDeepLink(baseUrl, token), label: 'Add to Cursor' },
      fallback: { intro: 'Or add to ~/.cursor/mcp.json:', code: cursorConfig(baseUrl, token) },
      caution: DEEP_LINK_CAUTION,
    },
    {
      key: 'vscode',
      label: 'VS Code',
      intro: 'One click installs the server for Copilot in VS Code.',
      code: `code --add-mcp '${vscodeConfig}'`,
      deepLink: { href: vscodeDeepLink(baseUrl, token), label: 'Add to VS Code' },
      fallback: { intro: 'Or from the command line:', code: `code --add-mcp '${vscodeConfig}'` },
      caution: DEEP_LINK_CAUTION,
    },
    {
      key: 'gemini',
      label: 'Gemini CLI',
      intro: 'Run this in your terminal (writes mcpServers.remill into ~/.gemini/settings.json).',
      code: `gemini mcp add --transport http remill ${baseUrl}/mcp --header "Authorization: Bearer ${token}"`,
    },
    {
      key: 'curl',
      label: 'curl',
      intro: 'No MCP client? The same token works on the JSON REST API.',
      code: `curl -H "Authorization: Bearer ${token}" "${baseUrl}/api/collections"
curl -H "Authorization: Bearer ${token}" "${baseUrl}/api/c/<collection>"`,
    },
  ];
}

/** Wizard client-select value → the card fronted after minting. */
export const CLIENT_TO_SNIPPET: Record<string, string> = {
  'claude-code': 'claude-code',
  cursor: 'cursor',
  vscode: 'vscode',
  'gemini-cli': 'gemini',
  'other-mcp': 'mcp-json',
  rest: 'curl',
};

/**
 * URL-only connect steps per client — no token: the client discovers remill's
 * OAuth server from the 401 challenge and the person approves in a browser
 * (D48). The public quickstart's client buttons. No deep links: they would
 * install whatever URL is baked in, and the homepage passes the placeholder.
 */
export function urlConnectSnippets(baseUrl: string): ConnectSnippet[] {
  const url = `${baseUrl}/mcp`;
  const approve = 'Approve the connection when your mill opens in the browser.';
  return [
    {
      key: 'claude',
      label: 'Claude',
      intro: 'claude.ai and Claude Desktop connect by URL alone.',
      steps: [
        'Open Settings → Connectors and choose Add custom connector.',
        'Name it remill and paste the URL below.',
        `Select Connect. ${approve}`,
      ],
      code: url,
    },
    {
      key: 'chatgpt',
      label: 'ChatGPT',
      intro: 'Custom connectors need developer mode, which depends on your ChatGPT plan.',
      steps: [
        'Open Settings → Apps & Connectors → Advanced settings and turn on Developer mode.',
        'Choose Create, name it remill, paste the URL below, and pick OAuth for authentication.',
        `Select Connect. ${approve} Then add remill to a chat from the tools menu.`,
      ],
      code: url,
    },
    {
      key: 'gemini',
      label: 'Gemini CLI',
      intro: 'Run this in your terminal, then run /mcp auth remill inside Gemini CLI to sign in.',
      code: `gemini mcp add --transport http remill ${url}`,
    },
    {
      key: 'copilot',
      label: 'Copilot',
      intro:
        'For GitHub Copilot in VS Code: run this, then choose Authorize when VS Code starts the server. ' +
        'Use Copilot Chat in Agent mode.',
      code: `code --add-mcp '${JSON.stringify({ name: 'remill', type: 'http', url })}'`,
    },
    {
      key: 'cursor',
      label: 'Cursor',
      intro: "Add this to ~/.cursor/mcp.json, then sign in from remill's entry in Cursor's MCP settings.",
      code: JSON.stringify({ mcpServers: { remill: { url } } }, null, 2),
    },
    {
      key: 'claude-code',
      label: 'Claude Code',
      intro: 'Run this in your terminal, then run /mcp inside Claude Code to sign in.',
      code: `claude mcp add --transport http remill ${url}`,
    },
  ];
}
