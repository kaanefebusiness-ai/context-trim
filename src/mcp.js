import { scanCodebase, formatAIContext } from './index.js';

/**
 * Lightweight Zero-Dependency MCP Server over standard I/O (JSON-RPC 2.0).
 * Compatible with Claude Desktop, Claude Code, Cursor, Antigravity.
 */
export function startMCPServer() {
  const SERVER_NAME = 'context-trim';
  const SERVER_VERSION = '1.0.0';

  const tools = [
    {
      name: 'get_clean_codebase_context',
      description: 'Scans and packs the current project into an optimized token-trimmed markdown context for LLMs.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Target directory path to pack (defaults to current working directory).'
          },
          budget: {
            type: 'number',
            description: 'Maximum token budget cap (e.g. 50000).'
          }
        }
      }
    },
    {
      name: 'analyze_token_waste',
      description: 'Analyzes which files, lockfiles, or directories in the project are consuming the most tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Target directory path to inspect.'
          }
        }
      }
    }
  ];

  function sendResponse(id, result) {
    const payload = JSON.stringify({ jsonrpc: '2.0', id, result });
    process.stdout.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`);
  }

  function sendError(id, code, message) {
    const payload = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
    process.stdout.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`);
  }

  let buffer = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;

    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        // Fallback for simple line-by-line JSON-RPC
        const lineEnd = buffer.indexOf('\n');
        if (lineEnd !== -1) {
          const line = buffer.slice(0, lineEnd).trim();
          buffer = buffer.slice(lineEnd + 1);
          if (line) {
            try {
              handleMessage(JSON.parse(line));
            } catch (_) {}
          }
          continue;
        }
        break;
      }

      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + contentLength) {
        break; // Wait for full body
      }

      const body = buffer.slice(bodyStart, bodyStart + contentLength);
      buffer = buffer.slice(bodyStart + contentLength);

      try {
        const msg = JSON.parse(body);
        handleMessage(msg);
      } catch (err) {
        // Ignore parse error
      }
    }
  });

  function handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    const { id, method, params } = msg;

    if (method === 'initialize') {
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      });
      return;
    }

    if (method === 'notifications/initialized') {
      return;
    }

    if (method === 'tools/list') {
      sendResponse(id, { tools });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};
      const targetDir = args.path || process.cwd();

      if (toolName === 'get_clean_codebase_context') {
        try {
          const scan = scanCodebase(targetDir);
          const output = formatAIContext(scan, { budget: args.budget });
          sendResponse(id, {
            content: [{ type: 'text', text: output }]
          });
        } catch (err) {
          sendError(id, -32000, err.message);
        }
        return;
      }

      if (toolName === 'analyze_token_waste') {
        try {
          const scan = scanCodebase(targetDir);
          const report = [
            `# Token Waste Analysis for: ${targetDir}`,
            `- Total Clean Files Included: ${scan.totalFiles}`,
            `- Total Tokens: ${scan.totalTokens.toLocaleString()}`,
            `- Unwanted / Bloat Files Filtered Out: ${scan.skippedCount}`,
            `\n### Top 10 Heaviest Files:\n`,
            ...scan.files
              .sort((a, b) => b.tokens - a.tokens)
              .slice(0, 10)
              .map((f, i) => `${i + 1}. \`${f.path}\` -> ${f.tokens.toLocaleString()} tokens (${Math.round(f.size / 1024)} KB)`)
          ].join('\n');

          sendResponse(id, {
            content: [{ type: 'text', text: report }]
          });
        } catch (err) {
          sendError(id, -32000, err.message);
        }
        return;
      }

      sendError(id, -32601, `Unknown tool: ${toolName}`);
      return;
    }

    if (id !== undefined) {
      sendError(id, -32601, `Method not found: ${method}`);
    }
  }
}
