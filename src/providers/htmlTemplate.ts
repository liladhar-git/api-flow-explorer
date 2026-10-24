/** Pure HTML/CSP builder (no VS Code imports) so tests can load the exact markup the extension serves. */
export interface HtmlParts {
  /** `webview.cspSource` in VS Code. */
  cspSource: string;
  scriptUri: string;
  styleUri: string;
  nonce: string;
}

export function buildCsp(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `style-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
  ].join('; ');
}

export function buildHtml(p: HtmlParts): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${buildCsp(p.cspSource, p.nonce)}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${p.styleUri}" />
<title>API Flow Graph</title>
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${p.nonce}" src="${p.scriptUri}"></script>
</body>
</html>`;
}

/** Same strict CSP and markup shape, for the sidebar endpoint list. */
export function buildSidebarHtml(p: HtmlParts): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${buildCsp(p.cspSource, p.nonce)}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${p.styleUri}" />
<title>API Endpoints</title>
</head>
<body>
<div id="root"></div>
<script nonce="${p.nonce}" src="${p.scriptUri}"></script>
</body>
</html>`;
}
