# context-trim Privacy Policy

Last updated: 2026-10-31

context-trim is an open-source tool by Kaan Efe Demir that packs source code into a lean Markdown document for AI assistants. This policy covers the command-line tool, the local MCP server, the Claude plugin, and the hosted remote MCP server.

## Local use (CLI, local MCP server, Claude plugin)

- context-trim runs entirely on your computer and makes **no network requests**.
- It reads files only inside the folder you point it at. The MCP server refuses any folder outside the workspace it was started in.
- Credential files (such as `.env`, private keys and `.npmrc`) are never read. API keys and passwords found inside other files are replaced with `[REDACTED_SECRET_KEY]` before the result is returned.
- The result goes only to the place you choose: your terminal, a file you name, your clipboard, or the AI assistant that called the tool. What that assistant does with it is covered by the assistant provider's own privacy policy.
- No analytics, telemetry, cookies or accounts.

## Hosted remote MCP server

The remote server only works with **public** GitHub repositories.

- **Data we receive:** the repository name or URL you ask for, the optional token budget, and standard connection data (IP address, request time) that our hosting provider sees for every web request.
- **Purpose:** to download that public repository from GitHub, filter it and return the packed text to your AI assistant. Nothing else.
- **Recipients:** the repository is downloaded from GitHub (codeload.github.com). The packed result goes back only to the AI assistant that made the request. We do not sell or share data with anyone else.
- **Retention:** the downloaded repository is unpacked into a temporary folder and deleted as soon as the request finishes. We do not store repository contents, requests or results. Our hosting provider may keep standard access logs (IP address, time, status code) for up to 30 days for security.
- **Personal data:** we do not ask for names, emails, accounts, location or conversation history, and the server needs no login.
- **Your controls:** you choose which repository is sent. Because nothing is stored, there is nothing to delete; you can stop using the server at any time by disconnecting it in your AI assistant.

## Children

context-trim is a developer tool and is not directed at children under 13.

## Changes

Changes to this policy are published in this file in the public repository with a new date at the top.

## Contact

Questions or requests: open an issue at [github.com/kaanefebusiness-ai/context-trim/issues](https://github.com/kaanefebusiness-ai/context-trim/issues).
