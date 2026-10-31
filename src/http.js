import fs from 'node:fs';
import http from 'node:http';
import { createMessageHandler, SERVER_NAME, SERVER_VERSION } from './mcp.js';
import * as remote from './remote.js';

/**
 * Streamable HTTP transport for the remote server (ChatGPT, Claude connectors).
 * Stateless: every POST /mcp carries a full JSON-RPC message and gets a JSON reply.
 * It only reads public GitHub repositories, never the host's disk.
 */

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_CONCURRENT_SCANS = Number(process.env.CONTEXT_TRIM_MAX_CONCURRENCY || 4);

const privacyMarkdown = fs.readFileSync(new URL('../PRIVACY.md', import.meta.url), 'utf8');

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Small Markdown → HTML for the privacy page: headings, lists, paragraphs, links
function renderPrivacyPage() {
  const inline = s => escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const html = [];
  let inList = false;
  for (const line of privacyMarkdown.split('\n')) {
    const item = line.match(/^[-*] (.*)/);
    if (inList && !item) { html.push('</ul>'); inList = false; }
    const heading = line.match(/^(#{1,3}) (.*)/);
    if (heading) html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
    else if (item) { if (!inList) { html.push('<ul>'); inList = true; } html.push(`<li>${inline(item[1])}</li>`); }
    else if (line.trim()) html.push(`<p>${inline(line)}</p>`);
  }
  if (inList) html.push('</ul>');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>context-trim Privacy Policy</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#1a1a1a;background:#fff}code{background:#f2f2f2;padding:1px 4px}</style>
</head><body>${html.join('\n')}</body></html>`;
}

/**
 * Plain (req, res) listener, usable by node:http and by serverless hosts (Vercel).
 */
export function createRequestListener() {
  const privacyPage = renderPrivacyPage();
  let activeScans = 0;

  const limitedRemote = {
    async withRepository(input, use) {
      if (activeScans >= MAX_CONCURRENT_SCANS) {
        throw new Error('Server is busy packing other repositories. Try again in a few seconds.');
      }
      activeScans++;
      try {
        return await remote.withRepository(input, use);
      } finally {
        activeScans--;
      }
    }
  };

  const handleMessage = createMessageHandler({ mode: 'remote', remote: limitedRemote });

  function sendJSON(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
    res.end(payload);
  }

  return function listener(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');

    // OpenAI plugin domain verification: the token shown in the portal, as plain text
    if (req.method === 'GET' && pathname === '/.well-known/openai-apps-challenge') {
      const token = process.env.OPENAI_APPS_CHALLENGE;
      if (!token) return sendJSON(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(token.trim());
    }

    if (req.method === 'GET' && (pathname === '/' || pathname === '/health')) {
      return sendJSON(res, 200, { name: SERVER_NAME, version: SERVER_VERSION, mcp: '/mcp', privacy: '/privacy' });
    }
    if (req.method === 'GET' && pathname === '/privacy') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(privacyPage);
    }
    if (pathname !== '/mcp') {
      return sendJSON(res, 404, { error: 'Not found' });
    }
    if (req.method !== 'POST') {
      // Stateless server: no server-initiated stream (GET) and no sessions to end (DELETE)
      res.writeHead(405, { Allow: 'POST' });
      return res.end();
    }

    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        sendJSON(res, 413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      let msg;
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (_) {
        return sendJSON(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      }

      const messages = Array.isArray(msg) ? msg : [msg];
      const replies = (await Promise.all(messages.map(handleMessage))).filter(Boolean);
      if (!replies.length) {
        res.writeHead(202);
        return res.end();
      }
      sendJSON(res, 200, Array.isArray(msg) ? replies : replies[0]);
    });
  };
}

export function startHTTPServer({ port = Number(process.env.PORT || 8787), host = process.env.HOST || '0.0.0.0' } = {}) {
  const server = http.createServer(createRequestListener());
  server.listen(port, host, () => {
    console.error(`context-trim remote MCP server listening on http://${host}:${port}/mcp`);
  });
  return server;
}
