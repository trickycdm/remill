/**
 * Per-client MCP connection artifacts (D48): pure builders shared by the
 * connect wizard's cards and the marketing quickstart (which passes the
 * `<token>` placeholder), so the two can never drift. Values are interpolated
 * into JSX TEXT (or copied via textContent) — never into Datastar expressions.
 */

export interface ConnectSnippet {
  /** Tab identity + Datastar signal value (closed vocabulary, server-owned). */
  readonly key: string;
  /** Tab label. */
  readonly label: string;
  /** One-line instruction above the code block. */
  readonly intro: string;
  /** The paste-ready artifact. */
  readonly code: string;
  /** Optional one-click install link (deep-link clients). */
  readonly deepLink?: { readonly href: string; readonly label: string };
  /** Secondary artifact shown under the deep link (config-file fallback). */
  readonly fallback?: { readonly intro: string; readonly code: string };
  /** Muted caution line (e.g. deep links embed the token). */
  readonly caution?: string;
}

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
