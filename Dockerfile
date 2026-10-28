FROM node:20-alpine

WORKDIR /app

COPY package.json README.md LICENSE ./
COPY src/ ./src/
COPY bin/ ./bin/

RUN chmod +x ./bin/cli.js

ENTRYPOINT ["node", "./bin/cli.js", "--mcp"]
