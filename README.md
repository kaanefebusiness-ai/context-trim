# context-trim ✂️

> **Cut codebase token bloat by 70%+ when packing context for LLMs.**  
> Ultra-fast CLI and zero-dependency MCP server for **Claude Code, Cursor, Codex, ChatGPT, and Antigravity**.

[![CI](https://github.com/kaanefebusiness-ai/context-trim/actions/workflows/ci.yml/badge.svg)](https://github.com/kaanefebusiness-ai/context-trim/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/badge/npm-v1.2.0-blue.svg)](https://www.npmjs.com/package/context-trim)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)]()
[![MCP Ready](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)

---

## ⚡ Why context-trim?

When you pass entire repositories to AI assistants:
* Massive lockfiles (`package-lock.json`, `poetry.lock`, `yarn.lock`) waste **50,000+ tokens per query**.
* Build output folders (`dist`, `.next`, `target`, `vendor`, `__pycache__`) flood context windows.
* Sensitive API keys (`sk-ant-...`, `sk-proj-...`, `ghp_...`) accidentally leak into LLM prompts.

**`context-trim` automatically sanitizes, strips out bloat, masks secrets, and outputs a clean context pack directly to your clipboard or file.**

---

## 🚀 Quick Start

Run instantly with `npx`:

```bash
# Scan and pack directly into your clipboard (Cmd+V into Claude / ChatGPT)
npx context-trim -c

# Scan current repository and save a clean ai-context.md
npx context-trim

# Check token waste and see estimated dollar savings
npx context-trim --stats

# Preview the clean file tree that LLMs will receive
npx context-trim --tree

# Save with a strict token ceiling
npx context-trim -o prompt.md --budget 40000
```

---

## 🛡️ Built-in Security Shield

`context-trim` scans file contents before dispatch and automatically redacts credentials:
* Anthropic API Keys (`sk-ant-...`)
* OpenAI API Keys (`sk-proj-...`, `sk-...`)
* GitHub Personal Access Tokens (`ghp_...`)
* AWS Access Keys (`AKIA...`)
* Slack Tokens & SSH Private Keys

Masked keys are safely replaced with `[REDACTED_SECRET_KEY]`.

---

## 🔌 Use as an MCP Server (Claude Desktop & Claude Code)

`context-trim` comes with native **Model Context Protocol (MCP)** support built-in without installing external packages.

Add it to your Claude configuration (`claude_desktop_config.json`):

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
* **`get_clean_codebase_context`**: Feeds Claude a lean codebase representation without lockfile and cache bloat.
* **`analyze_token_waste`**: Identifies the heaviest files eating tokens in your workspace.

---

## ⚙️ CLI Options

| Flag | Description |
|---|---|
| `-c, --copy` | Copy packed context directly to native clipboard (macOS, Windows, Linux). |
| `-o, --output <file>` | Custom path to save the generated markdown pack (default: `ai-context.md`). |
| `--stats` | Show token count, skipped files, and estimated cost savings. |
| `--tree` | Print the filtered file tree with token estimates per file. |
| `--budget <num>` | Cap context at a specific token ceiling (e.g. `--budget 50000`). |
| `--mcp` | Start as an MCP server over stdio for Claude / Cursor / Antigravity. |
| `-v, --version` | Output version number. |
| `-h, --help` | Display command-line help. |

---

## 📦 Zero Dependencies

Written in native Node.js ESM. Runs in under 2ms with **zero external dependencies**. Compatible with macOS, Windows, and Linux.

---

## 📄 License

MIT © [Kaan Efe Demir](https://github.com/kaanefebusiness-ai)
