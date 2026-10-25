# syntax=docker/dockerfile:1

FROM node:22.13.0-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm install --global pnpm@9.15.9

WORKDIR /app

COPY bidflo/package.json bidflo/pnpm-lock.yaml bidflo/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY bidflo/ ./
RUN pnpm run build

FROM node:22.13.0-bookworm-slim AS runner

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=10000

RUN npm install --global pnpm@9.15.9

WORKDIR /app
COPY --from=builder --chown=node:node /app /app

EXPOSE 10000
USER node

CMD ["pnpm", "start"]
