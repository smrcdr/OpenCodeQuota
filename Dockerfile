FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --chown=bun:bun src ./src
COPY --chown=bun:bun public ./public
RUN mkdir -p /app/config /app/data && chown -R bun:bun /app/config /app/data

USER bun

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=40129

EXPOSE 40129

CMD ["bun", "src/server.js"]

