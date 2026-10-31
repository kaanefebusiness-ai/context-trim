---
name: pack-github-repo
description: Use when the user shares a public GitHub repository (owner/repo or a github.com link) and wants it reviewed, explained, summarized or sized. Packs the repository with the context-trim tools instead of guessing from its name.
---

# Pack a public GitHub repository with context-trim

Use the context-trim tools when the user points at a public GitHub repository and the task needs its code.

## Steps

1. Call `analyze_github_repository_waste` first. It shows the token cost and the 10 heaviest files.
2. If the total is under about 20,000 tokens, call `pack_github_repository` with the repository.
3. If it is larger, pack a specific branch with a `/tree/<branch>` link only when the user asks for one, or raise `budget` only when the user accepts a long answer. Files past the budget are listed by name only, so say which ones were left out.
4. Answer from the packed result.

## Limits to tell the user about

- Only public repositories on github.com work. For a private repository, say so and ask the user to paste the relevant files.
- Credential files such as `.env` are left out and API keys in code are masked on purpose.
- Repositories above 50 MB compressed are refused.
