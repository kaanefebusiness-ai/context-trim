# context-trim ✂️

> **Cut codebase token bloat by 70%+ when packing context for LLMs.**  
> Ultra-fast CLI and zero-dependency MCP server for **Claude Code, Cursor, Codex, ChatGPT, and Antigravity**.

[![npm version](https://img.shields.io/badge/npm-v1.0.0-blue.svg)](https://www.npmjs.com/package/context-trim)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)]()
[![MCP Ready](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)

---

## ⚡ The Problem

When you prompt an AI coding assistant (Claude Code, ChatGPT, Cursor) with your repository:
* Massive lockfiles (`package-lock.json`, `poetry.lock`, `yarn.lock`) consume **50,000+ unnecessary tokens**.
* Build output folders (`dist`, `.next`, `build`, `__pycache__`) flood context windows.
* Minified files, maps, images, and binary artifacts waste money, trigger rate limits, and degrade model reasoning.

**`context-trim` automatically strips out all bloat, estimates token consumption, and outputs a clean, structured context pack ready for any LLM.**

---

## 🚀 Quick Start

No installation needed. Run directly with `npx`:

```bash
# Scan current repository and save a clean ai-context.md
npx context-trim

# Check token waste and see what's eating your context window
npx context-trim --stats

# Preview the clean file tree that LLMs will receive
npx context-trim --tree

# Save to a custom output file with a strict token budget
npx context-trim -o prompt.md --budget 40000
```

---

## 🔌 Use as an MCP Server (Claude Desktop & Claude Code)

`context-trim` comes with native **Model Context Protocol (MCP)** support built-in without installing external dependencies.

Add it to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "context-trim": {
      "command": "npx",
      "args": ["-y", "context-trim", "--mcp"]
    }
  }
}
```

### Exposed MCP Tools:
* **`get_clean_codebase_context`**: Feeds Claude a lean, optimized codebase representation without lockfile bloat.
* **`analyze_token_waste`**: Identifies the heaviest files eating tokens in your workspace.

---

## ⚙️ CLI Options

| Flag | Description |
|---|---|
| `-o, --output <file>` | Custom path to save the generated markdown pack (default: `ai-context.md`). |
| `--stats` | Show token count, skipped files, and size breakdown without writing a file. |
| `--tree` | Print the filtered file tree with token estimates per file. |
| `--budget <num>` | Cap context at a specific token ceiling (e.g. `--budget 50000`). |
| `--mcp` | Start as an MCP server over stdio for Claude / Cursor / Antigravity. |
| `-v, --version` | Output version number. |
| `-h, --help` | Display command-line help. |

---

## 🛡️ Default Smart Filters

`context-trim` ignores by default:
* **Directories:** `node_modules`, `.git`, `.next`, `.nuxt`, `dist`, `build`, `out`, `coverage`, `.venv`, `__pycache__`, `.turbo`, `.cache`, `.idea`, `.vscode`.
* **Lockfiles:** `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `poetry.lock`, `Cargo.lock`, `bun.lockb`.
* **Media & Binaries:** Images, videos, fonts, zips, PDFs, compiled binaries (`.so`, `.dll`, `.exe`).
* **Minified & Maps:** `*.min.js`, `*.min.css`, `*.map`.
* **Local `.gitignore` rules:** Respected automatically.

---

## 📦 Zero Dependencies

Written in native Node.js ESM. It requires **no external npm dependencies**, starts in under 2ms, and runs anywhere Node 18+ is available.

---

## 📄 License

MIT © [Kaan Efe Demir](https://github.com/kaanefebusiness-ai)
