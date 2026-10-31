import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanCodebase, formatAIContext } from './index.js';

/**
 * Lightweight Zero-Dependency MCP Server (JSON-RPC 2.0).
 * One message handler shared by the stdio transport (local, reads your disk)
 * and the Streamable HTTP transport (remote, reads public GitHub repositories).
 */

export const SERVER_NAME = 'context-trim';
export const SERVER_VERSION = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;

// Newest first. We answer with the client's version when we support it.
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

// Claude Code warns above ~25k tokens of tool output, so stay under it by default
export const DEFAULT_MCP_BUDGET = 20000;

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true
};

const budgetProperty = {
  type: 'integer',
  minimum: 1000,
  description: `Maximum tokens to return (default ${DEFAULT_MCP_BUDGET.toLocaleString()}). Files past the budget are listed by name only.`
};

const LOCAL_TOOLS = [
  {
    name: 'get_clean_codebase_context',
    title: 'Pack Clean Codebase Context',
    description:
      'Reads the project folder on this machine and returns its source files as one Markdown document, ' +
      'leaving out lockfiles, build output, caches, binaries and credential files (.env, keys), and masking API keys found in code. ' +
      'Use it when you need an overview of a whole project in one call. Read-only: it never writes, deletes or sends anything. ' +
      'Only folders inside the workspace the server was started in can be read.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Folder to pack, absolute or relative to the workspace root. Defaults to the workspace root.'
        },
        budget: budgetProperty
      },
      additionalProperties: false
    },
    annotations: { title: 'Pack Clean Codebase Context', ...READ_ONLY_ANNOTATIONS, openWorldHint: false }
  },
  {
    name: 'analyze_token_waste',
    title: 'Analyze Token Waste',
    description:
      'Reports how many tokens a project folder on this machine would cost, how many bloat files are filtered out, ' +
      'and which 10 files are the heaviest. Use it before packing to decide what to trim. Read-only. ' +
      'Only folders inside the workspace the server was started in can be read.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Folder to inspect, absolute or relative to the workspace root. Defaults to the workspace root.'
        }
      },
      additionalProperties: false
    },
    annotations: { title: 'Analyze Token Waste', ...READ_ONLY_ANNOTATIONS, openWorldHint: false }
  }
];

const repositoryProperty = {
  type: 'string',
  description: 'Public GitHub repository, as "owner/repo" or a https://github.com/owner/repo URL. A /tree/<branch> URL selects that branch.'
};

const REMOTE_TOOLS = [
  {
    name: 'pack_github_repository',
    title: 'Pack GitHub Repository',
    description:
      'Downloads a public GitHub repository and returns its source files as one Markdown document, ' +
      'leaving out lockfiles, build output, caches, binaries and credential files, and masking API keys found in code. ' +
      'Use it when the user shares a public GitHub repository and wants it reviewed, explained or summarized. ' +
      'Read-only. Private repositories are not supported. Nothing is stored after the call.',
    inputSchema: {
      type: 'object',
      properties: { repository: repositoryProperty, budget: budgetProperty },
      required: ['repository'],
      additionalProperties: false
    },
    annotations: { title: 'Pack GitHub Repository', ...READ_ONLY_ANNOTATIONS, openWorldHint: true }
  },
  {
    name: 'analyze_github_repository_waste',
    title: 'Analyze GitHub Repository Size',
    description:
      'Downloads a public GitHub repository and reports its token cost, how many bloat files are filtered out, ' +
      'and which 10 files are the heaviest. Use it to judge whether a repository fits in context before packing it. ' +
      'Read-only. Private repositories are not supported. Nothing is stored after the call.',
    inputSchema: {
      type: 'object',
      properties: { repository: repositoryProperty },
      required: ['repository'],
      additionalProperties: false
    },
    annotations: { title: 'Analyze GitHub Repository Size', ...READ_ONLY_ANNOTATIONS, openWorldHint: true }
  }
];

/**
 * Resolve a requested path and refuse anything outside the workspace roots.
 * Relative paths resolve against the first root.
 */
export function resolveInsideRoot(roots, requested) {
  const realRoots = [].concat(roots).map(r => fs.realpathSync(r));
  const target = path.resolve(realRoots[0], requested || '.');
  let realTarget;
  try {
    realTarget = fs.realpathSync(target);
  } catch (_) {
    throw new Error(`Folder not found: ${requested}`);
  }
  const inside = realRoots.some(root => {
    const rel = path.relative(root, realTarget);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  });
  if (!inside) {
    throw new Error(`Access denied: "${requested}" is outside the workspace (${realRoots.join(', ')}).`);
  }
  return realTarget;
}

/**
 * Turn MCP roots (file:// URIs from roots/list) into existing local folders.
 */
export function rootsFromList(list) {
  return (list || [])
    .map(r => {
      try {
        return r?.uri?.startsWith('file:') ? fileURLToPath(r.uri) : null;
      } catch (_) {
        return null;
      }
    })
    .filter(p => p && fs.existsSync(p));
}

function readBudget(value) {
  if (value === undefined || value === null) return DEFAULT_MCP_BUDGET;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1000) throw new Error('budget must be a number of at least 1000.');
  return Math.floor(n);
}

export function formatWasteReport(scan, label) {
  return [
    `# Token Waste Analysis for: ${label}`,
    `- Total Clean Files Included: ${scan.totalFiles}`,
    `- Total Tokens: ${scan.totalTokens.toLocaleString()}`,
    `- Unwanted / Bloat Files Filtered Out: ${scan.skippedCount}`,
    `- Credential Files Left Out: ${scan.secretFilesSkipped}`,
    `- Secrets Masked In Code: ${scan.totalSecretsMasked}`,
    ...(scan.truncatedAtFileLimit ? [`- Note: stopped at the ${scan.maxFiles.toLocaleString()}-file limit`] : []),
    `\n### Top 10 Heaviest Files:\n`,
    ...[...scan.files]
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 10)
      .map((f, i) => `${i + 1}. \`${f.path}\` -> ${f.tokens.toLocaleString()} tokens (${Math.round(f.size / 1024)} KB)`)
  ].join('\n');
}

/**
 * Build a JSON-RPC message handler.
 * mode 'local'  → tools read folders under `root`
 * mode 'remote' → tools read public GitHub repositories through `remote`
 */
export function createMessageHandler({ mode = 'local', root = process.cwd(), getRoots, remote } = {}) {
  const currentRoots = () => {
    const fromClient = getRoots ? getRoots() : [];
    return fromClient.length ? fromClient : [root];
  };
  const tools = mode === 'remote' ? REMOTE_TOOLS : LOCAL_TOOLS;

  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  const text = (body, isError = false) => ({ content: [{ type: 'text', text: body }], ...(isError ? { isError: true } : {}) });

  async function callTool(name, args) {
    if (mode === 'local') {
      if (name === 'get_clean_codebase_context') {
        const budget = readBudget(args.budget);
        const scan = scanCodebase(resolveInsideRoot(currentRoots(), args.path));
        return text(formatAIContext(scan, { budget }));
      }
      if (name === 'analyze_token_waste') {
        const dir = resolveInsideRoot(currentRoots(), args.path);
        return text(formatWasteReport(scanCodebase(dir), dir));
      }
    } else {
      if (name === 'pack_github_repository') {
        const budget = readBudget(args.budget);
        return text(await remote.withRepository(args.repository, (scan, label) =>
          formatAIContext(scan, { budget }).replace('# Codebase Context', `# Codebase Context: ${label}`)));
      }
      if (name === 'analyze_github_repository_waste') {
        return text(await remote.withRepository(args.repository, (scan, label) => formatWasteReport(scan, label)));
      }
    }
    return null;
  }

  return async function handleMessage(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
      return fail(null, -32600, 'Invalid Request');
    }
    const { id, method, params } = msg;
    const isNotification = id === undefined;

    // Notifications (initialized, cancelled, ...) never get a reply
    if (isNotification) return null;

    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion;
        return ok(id, {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, title: 'context-trim', version: SERVER_VERSION },
          instructions: mode === 'remote'
            ? 'Packs public GitHub repositories into lean Markdown context. Call analyze_github_repository_waste first for large repositories.'
            : 'Packs the local project into lean Markdown context. Call analyze_token_waste first for large projects.'
        });
      }
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, { tools });
      case 'tools/call': {
        const name = params?.name;
        if (!tools.some(t => t.name === name)) {
          return fail(id, -32602, `Unknown tool: ${name}`);
        }
        try {
          return ok(id, await callTool(name, params?.arguments || {}));
        } catch (err) {
          // Tool failures go back as results so the model can read and react to them
          return ok(id, text(`Error: ${err.message}`, true));
        }
      }
      default:
        return fail(id, -32601, `Method not found: ${method}`);
    }
  };
}

/**
 * stdio transport: one JSON-RPC message per line, nothing else on stdout.
 * Workspace = the client's MCP roots when it shares them (Claude Code, Codex),
 * otherwise CONTEXT_TRIM_ROOT or the working directory.
 */
export function startMCPServer() {
  const root = process.env.CONTEXT_TRIM_ROOT || process.cwd();
  let clientRoots = [];
  let clientSupportsRoots = false;
  let rootsRequestId = 0;

  const handleMessage = createMessageHandler({ mode: 'local', root, getRoots: () => clientRoots });
  const send = message => process.stdout.write(JSON.stringify(message) + '\n');

  const requestRoots = () => {
    if (clientSupportsRoots) send({ jsonrpc: '2.0', id: `roots-${++rootsRequestId}`, method: 'roots/list' });
  };

  // Our own requests to the client, plus the notifications that trigger them
  function handleClientTraffic(msg) {
    if (msg.method === 'initialize') {
      clientSupportsRoots = Boolean(msg.params?.capabilities?.roots);
    } else if (msg.method === 'notifications/initialized' || msg.method === 'notifications/roots/list_changed') {
      requestRoots();
    } else if (typeof msg.id === 'string' && msg.id.startsWith('roots-') && !msg.method) {
      if (msg.result) clientRoots = rootsFromList(msg.result.roots);
      return true; // a reply to us, not a request for us
    }
    return false;
  }

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let lineEnd;
    while ((lineEnd = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (!line) continue;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch (_) {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        continue;
      }

      const messages = (Array.isArray(msg) ? msg : [msg]).filter(m => !(m && typeof m === 'object' && handleClientTraffic(m)));
      if (!messages.length) continue;
      Promise.all(messages.map(handleMessage)).then(replies => {
        const out = replies.filter(Boolean);
        if (out.length) send(Array.isArray(msg) ? out : out[0]);
      });
    }
  });
  process.stdin.on('end', () => process.exit(0));
}
