#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { scanCodebase, formatAIContext } from '../src/index.js';
import { startMCPServer } from '../src/mcp.js';

const args = process.argv.slice(2);

// Check if MCP server mode is requested
if (args.includes('--mcp')) {
  startMCPServer();
  // Don't log anything in MCP mode as stdout is reserved for JSON-RPC
} else if (args.includes('--help') || args.includes('-h')) {
  console.log(`
context-trim ✂️  Cut codebase bloat for AI context windows.

USAGE:
  npx context-trim [options] [path]

OPTIONS:
  -o, --output <file>    Save packed context to a markdown file (e.g. ai-context.md)
  --stats                Print detailed token usage and bloat statistics only
  --tree                 Print filtered file tree only
  --budget <tokens>      Cap maximum token budget (e.g. 40000)
  --mcp                  Run as a Model Context Protocol (MCP) server for Claude / Cursor
  -v, --version          Show version
  -h, --help             Show help

EXAMPLES:
  npx context-trim                   # Packs current directory and prints summary
  npx context-trim -o ai-context.md  # Exports clean markdown ready for Claude / ChatGPT
  npx context-trim --stats           # Analyzes token bloat
  npx context-trim --mcp             # Starts MCP server
`);
  process.exit(0);
} else if (args.includes('--version') || args.includes('-v')) {
  console.log('context-trim v1.0.0');
  process.exit(0);
} else {
  runCLI();
}

function runCLI() {
  const isStats = args.includes('--stats');
  const isTree = args.includes('--tree');
  
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
  const scan = scanCodebase(targetDir);
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

  if (outputFile) {
    const dest = path.resolve(targetDir, outputFile);
    fs.writeFileSync(dest, packedMarkdown, 'utf8');
    console.log(`\n\x1b[32m✔ Successfully packed codebase into:\x1b[0m \x1b[1m${dest}\x1b[0m`);
  } else {
    // If no output file specified, save to default ai-context.md in current dir
    const defaultOutput = path.resolve(targetDir, 'ai-context.md');
    fs.writeFileSync(defaultOutput, packedMarkdown, 'utf8');
    console.log(`\n\x1b[32m✔ Context saved to:\x1b[0m \x1b[1m${defaultOutput}\x1b[0m`);
  }

  printStats(scan, elapsed);
  console.log(`\x1b[90m💡 Tip: Drop the generated file into Claude, ChatGPT, or Cursor for lean prompts.\x1b[0m\n`);
}

function printStats(scan, elapsed) {
  console.log('\n' + '─'.repeat(52));
  console.log(`\x1b[1m⚡ context-trim Summary\x1b[0m \x1b[90m(${elapsed}ms)\x1b[0m`);
  console.log('─'.repeat(52));
  console.log(`  Included Files       : \x1b[32m${scan.totalFiles}\x1b[0m`);
  console.log(`  Skipped Bloat Files  : \x1b[33m${scan.skippedCount} (lockfiles, binaries, node_modules...)\x1b[0m`);
  console.log(`  Estimated Tokens     : \x1b[36m~${scan.totalTokens.toLocaleString()}\x1b[0m`);
  console.log(`  Payload Size         : \x1b[36m${Math.round(scan.totalBytes / 1024)} KB\x1b[0m`);
  console.log('─'.repeat(52) + '\n');
}
