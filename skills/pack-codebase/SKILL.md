---
name: pack-codebase
description: Use when the user wants an overview of a whole project, asks to review, explain or summarize an entire codebase, or wants to know how many tokens a project costs. Packs the project with the context-trim MCP tools instead of reading files one by one.
---

# Pack a codebase with context-trim

Use the context-trim MCP tools when the task needs the whole project at once, not one or two files.

## Steps

1. Call `analyze_token_waste` first. It shows the total token cost and the 10 heaviest files.
2. If the total is under about 20,000 tokens, call `get_clean_codebase_context` with no `path`.
3. If it is larger, pick the relevant subfolder (for example `src` or `packages/api`) and pass it as `path`, or raise `budget` only when the user accepts a long answer. Files past the budget are listed by name only, so say which ones were left out.
4. Work from the packed result. Read single files directly only when you need a file that was left out.

## What the tools never do

- They never read outside the workspace the server was started in.
- They never read credential files such as `.env` or private keys, and they mask API keys found in code. If the user asks about a secret value, tell them it was masked on purpose.
- They never write, delete or send anything over the network.
