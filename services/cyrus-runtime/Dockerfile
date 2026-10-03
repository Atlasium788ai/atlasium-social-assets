FROM node:22.22.0-bookworm-slim

WORKDIR /app
COPY package.json ./
COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "src/index.js"]
