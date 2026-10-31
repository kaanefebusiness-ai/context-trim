# context-trim ✂️

> **Pack a whole codebase into lean Markdown context for LLMs: no lockfiles, no build output, no secrets.**
> Zero-dependency CLI, local MCP server, Claude plugin, and remote MCP server for **Claude Code, Claude, ChatGPT, Codex, and Cursor**.

[![CI](https://github.com/kaanefebusiness-ai/context-trim/actions/workflows/ci.yml/badge.svg)](https://github.com/kaanefebusiness-ai/context-trim/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/badge/npm-v1.3.0-blue.svg)](https://www.npmjs.com/package/context-trim)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)]()
[![MCP Ready](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)

---

## ⚡ Why context-trim?

When you hand a whole repository to an AI assistant:
* Lockfiles (`package-lock.json`, `poetry.lock`, `yarn.lock`) can cost tens of thousands of tokens and tell the model nothing.
* Build and cache folders (`dist`, `.next`, `target`, `vendor`, `__pycache__`) flood the context window.
* Credentials in `.env` files and source code (`sk-ant-...`, `sk-proj-...`, `ghp_...`) leak into prompts.

`context-trim` filters out the bloat, leaves credential files out, masks keys found in code, and gives you one clean Markdown pack in your clipboard, a file, or straight to your assistant through MCP. Run `--stats` to see exactly how many tokens it saves on your project.

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

**Credential files are never read.** `.env`, `.env.*` (except `.env.example`, `.env.sample`, `.env.template`), `.envrc`, private keys (`*.pem`, `*.key`, `id_rsa`, `id_ed25519` ...), `.npmrc`, `.pypirc`, `.netrc`, `credentials.json`, `secrets.yaml`, service-account JSON files and Terraform state are skipped entirely.

**Secrets inside other files are masked** with `[REDACTED_SECRET_KEY]`:
* Anthropic, OpenAI, Stripe, Google, AWS, GitHub and Slack keys and tokens
* JSON Web Tokens and private key blocks
* Passwords inside connection strings (`postgres://user:PASSWORD@host`)
* Quoted values and `.env`-style lines assigned to names such as `password`, `secret`, `api_key`, `access_token`

Masking is pattern-based and can't catch every possible secret, so review what you share when a repository holds sensitive data.

---

## 🔌 Claude Code plugin

Install the plugin and Claude gets the MCP tools plus a `pack-codebase` skill that tells it when to use them:

```bash
claude plugin marketplace add kaanefebusiness-ai/context-trim
claude plugin install context-trim
```

The plugin runs `node ${CLAUDE_PLUGIN_ROOT}/bin/cli.js --mcp` from its own folder. Nothing is downloaded at run time.

## 🔌 Local MCP server (Claude Desktop, Cursor, Codex)

Add it to your MCP configuration (for Claude Desktop, `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "context-trim": {
      "command": "npx",
      "args": ["-y", "context-trim@1.3.0", "--mcp"]
    }
  }
}
```

The server only reads folders inside the workspace: the project roots your client shares over MCP (Claude Code and Codex do this), otherwise `CONTEXT_TRIM_ROOT` or the folder it was started in. Requests for any other path, including symlinks that point outside, are refused.

| Tool | What it does | Annotations |
|---|---|---|
| `get_clean_codebase_context` | Packs a project folder into Markdown, up to `budget` tokens (default 20,000) | read-only, not destructive, closed world |
| `analyze_token_waste` | Shows total tokens, filtered files and the 10 heaviest files | read-only, not destructive, closed world |

## 🌐 Remote MCP server (ChatGPT, Claude connectors)

The remote server reads **public GitHub repositories only**. It never touches the disk of the machine it runs on beyond a temporary folder that is deleted after each request.

```bash
npx context-trim --http --port 8787        # serves POST /mcp, GET /privacy, GET /health
docker run -p 8787:8787 <image> --http     # same, from the Dockerfile
```

| Tool | What it does | Annotations |
|---|---|---|
| `pack_github_repository` | Downloads a public repository (`owner/repo` or a GitHub URL, `/tree/<branch>` supported) and packs it | read-only, not destructive, open world |
| `analyze_github_repository_waste` | Reports token cost and the heaviest files of a public repository | read-only, not destructive, open world |

Limits: 50 MB download, 200 MB unpacked, 5,000 files, 4 repositories at a time (`CONTEXT_TRIM_MAX_CONCURRENCY`).

---

## 🔒 Privacy

* **Local use (CLI, local MCP server, plugin):** context-trim makes no network requests, collects nothing, and has no telemetry. It reads only the folder you point it at, and the result goes only where you send it.
* **Remote server:** it receives the repository name you ask for, downloads that public repository from GitHub, returns the packed text, and deletes the download. It stores no repository contents, requests or results, and needs no account.

Full policy: [PRIVACY.md](PRIVACY.md) (also served by the remote server at `/privacy`). Terms: [TERMS.md](TERMS.md).

---

## ⚙️ CLI Options

| Flag | Description |
|---|---|
| `-c, --copy` | Copy packed context directly to native clipboard (macOS, Windows, Linux). |
| `-o, --output <file>` | Custom path to save the generated markdown pack (default: `ai-context.md`). |
| `--stats` | Show token count, skipped files, and estimated cost savings. |
| `--tree` | Print the filtered file tree with token estimates per file. |
| `--budget <num>` | Cap context at a specific token ceiling (e.g. `--budget 50000`). |
| `--mcp` | Start as a local MCP server over stdio. |
| `--http [--port <n>]` | Start as a remote MCP server over HTTP for public GitHub repositories. |
| `-v, --version` | Output version number. |
| `-h, --help` | Display command-line help. |

Token counts are estimates (about 3.8 characters per token), not exact tokenizer output.

---

## 📦 Zero Dependencies

Written in native Node.js ESM (Node 18+) with **zero external dependencies**. Compatible with macOS, Windows, and Linux.

## 💬 Support

Questions, bugs and requests: [GitHub Issues](https://github.com/kaanefebusiness-ai/context-trim/issues).

---

## 📄 License

MIT © [Kaan Efe Demir](https://github.com/kaanefebusiness-ai)
