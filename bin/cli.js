#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { scanCodebase, formatAIContext, copyToClipboard } from '../src/index.js';
import { startMCPServer, SERVER_VERSION } from '../src/mcp.js';

const args = process.argv.slice(2);

// Check if MCP server mode is requested
if (args.includes('--mcp')) {
  startMCPServer();
  // Don't log anything in MCP mode as stdout is reserved for JSON-RPC
} else if (args.includes('--http')) {
  const pIndex = args.indexOf('--port');
  const port = pIndex !== -1 && args[pIndex + 1] ? parseInt(args[pIndex + 1], 10) : undefined;
  const { startHTTPServer } = await import('../src/http.js');
  startHTTPServer(port ? { port } : {});
} else if (args.includes('--help') || args.includes('-h')) {
  console.log(`
context-trim ✂️  Cut codebase bloat for AI context windows.

USAGE:
  npx context-trim [options] [path]

OPTIONS:
  -o, --output <file>    Save packed context to a markdown file (e.g. ai-context.md)
  -c, --copy             Copy packed context directly to clipboard
  --stats                Print detailed token usage and bloat statistics only
  --tree                 Print filtered file tree only
  --budget <tokens>      Cap maximum token budget (e.g. 40000)
  --mcp                  Run as a local Model Context Protocol (MCP) server over stdio
  --http [--port <n>]    Run as a remote MCP server over HTTP for public GitHub repos
  -v, --version          Show version
  -h, --help             Show help

EXAMPLES:
  npx context-trim                   # Packs current directory and saves ai-context.md
  npx context-trim -c                # Packs and copies directly to clipboard
  npx context-trim -o prompt.md      # Exports clean markdown
  npx context-trim --stats           # Analyzes token bloat and estimated cost savings
  npx context-trim --mcp             # Starts local MCP server
  npx context-trim --http --port 8787  # Starts remote MCP server at /mcp
`);
  process.exit(0);
} else if (args.includes('--version') || args.includes('-v')) {
  console.log(`context-trim v${SERVER_VERSION}`);
  process.exit(0);
} else {
  runCLI();
}

async function runCLI() {
  const isStats = args.includes('--stats');
  const isTree = args.includes('--tree');
  const shouldCopy = args.includes('-c') || args.includes('--copy');
  
  let outputFile = null;
  const oIndex = args.indexOf('-o') !== -1 ? args.indexOf('-o') : args.indexOf('--output');
  if (oIndex !== -1 && args[oIndex + 1]) {
    outputFile = args[oIndex + 1];
  }

  let budget = Infinity;
  const bIndex = args.indexOf('--budget');
  if (bIndex !== -1 && args[bIndex + 1]) {
    budget = parseInt(args[bIndex + 1], 10);
  }

  // Find target directory (non-flag argument)
  let targetDir = process.cwd();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('-')) {
      if (i > 0 && (args[i - 1] === '-o' || args[i - 1] === '--output' || args[i - 1] === '--budget')) {
        continue;
      }
      targetDir = path.resolve(a);
      break;
    }
  }

  console.log(`\n🔍 Scanning codebase in: \x1b[36m${targetDir}\x1b[0m...`);

  const startTime = Date.now();
  let scan;
  try {
    scan = scanCodebase(targetDir);
  } catch (err) {
    console.error(`\n\x1b[31m✖ ${err.message}\x1b[0m\n`);
    process.exit(1);
  }
  const elapsed = Date.now() - startTime;

  if (isTree) {
    console.log(`\n📂 \x1b[1mFiltered File Tree:\x1b[0m\n`);
    scan.files.forEach(f => {
      console.log(`  \x1b[32m✔\x1b[0m ${f.path} \x1b[90m(~${f.tokens} tokens)\x1b[0m`);
    });
    console.log(`\nTotal: ${scan.totalFiles} files | ~${scan.totalTokens.toLocaleString()} tokens`);
    return;
  }

  if (isStats) {
    printStats(scan, elapsed);
    return;
  }

  // Pack context
  const packedMarkdown = formatAIContext(scan, { budget });

  if (shouldCopy) {
    try {
      await copyToClipboard(packedMarkdown);
      console.log(`\n\x1b[32m✔ Packed context copied directly to clipboard! (Ready to Cmd+V into Claude / ChatGPT)\x1b[0m`);
    } catch (_) {
      console.log(`\n\x1b[33m⚠ Clipboard not accessible in this environment, saving to file instead.\x1b[0m`);
      saveToFile(targetDir, outputFile, packedMarkdown);
    }
  } else {
    saveToFile(targetDir, outputFile, packedMarkdown);
  }

  printStats(scan, elapsed);
}

function saveToFile(targetDir, outputFile, content) {
  if (outputFile) {
    const dest = path.resolve(targetDir, outputFile);
    fs.writeFileSync(dest, content, 'utf8');
    console.log(`\n\x1b[32m✔ Successfully packed codebase into:\x1b[0m \x1b[1m${dest}\x1b[0m`);
  } else {
    const defaultOutput = path.resolve(targetDir, 'ai-context.md');
    fs.writeFileSync(defaultOutput, content, 'utf8');
    console.log(`\n\x1b[32m✔ Context saved to:\x1b[0m \x1b[1m${defaultOutput}\x1b[0m`);
  }
}

function printStats(scan, elapsed) {
  // Cost savings estimate at a typical mid-tier model input price (~$3 per 1M tokens)
  const estimatedSavingsUSD = ((scan.estimatedSavedTokens / 1_000_000) * 3.0).toFixed(4);

  console.log('\n' + '─'.repeat(54));
  console.log(`\x1b[1m⚡ context-trim Summary\x1b[0m \x1b[90m(${elapsed}ms)\x1b[0m`);
  console.log('─'.repeat(54));
  console.log(`  Included Clean Files : \x1b[32m${scan.totalFiles}\x1b[0m`);
  console.log(`  Skipped Bloat Files  : \x1b[33m${scan.skippedCount} (lockfiles, caches, artifacts)\x1b[0m`);
  console.log(`  Estimated Tokens     : \x1b[36m~${scan.totalTokens.toLocaleString()}\x1b[0m`);
  console.log(`  Payload Size         : \x1b[36m${Math.round(scan.totalBytes / 1024)} KB\x1b[0m`);
  if (scan.totalSecretsMasked > 0) {
    console.log(`  Security Shield      : \x1b[32m🛡️ ${scan.totalSecretsMasked} secret key(s) redacted\x1b[0m`);
  }
  if (scan.secretFilesSkipped > 0) {
    console.log(`  Credential Files     : \x1b[32m🔒 ${scan.secretFilesSkipped} left out (.env, keys)\x1b[0m`);
  }
  if (scan.estimatedSavedTokens > 0) {
    console.log(`  Estimated Savings    : \x1b[32m~${scan.estimatedSavedTokens.toLocaleString()} tokens (~$${estimatedSavingsUSD} per prompt)\x1b[0m`);
  }
  console.log('─'.repeat(54) + '\n');
}
