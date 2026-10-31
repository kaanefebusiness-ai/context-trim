FROM node:20-alpine

WORKDIR /app

COPY package.json README.md PRIVACY.md LICENSE ./
COPY src/ ./src/
COPY bin/ ./bin/

RUN chmod +x ./bin/cli.js

# Default: local stdio MCP server (Glama, Docker MCP clients).
# Remote server for ChatGPT / Claude connectors: docker run -p 8787:8787 <image> --http
ENV PORT=8787
EXPOSE 8787
USER node
ENTRYPOINT ["node", "./bin/cli.js"]
CMD ["--mcp"]
