FROM node:24.19.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate && pnpm install --frozen-lockfile --prod=false
RUN pnpm exec playwright install --with-deps chromium && chmod -R a+rx /ms-playwright
COPY . .
RUN pnpm build
COPY .next/standalone ./standalone
COPY .next/static ./standalone/.next/static
COPY public ./standalone/public
COPY scripts/healthcheck.mjs ./scripts/healthcheck.mjs
RUN mkdir -p /app/data /app/artifacts/private /app/artifacts/public
EXPOSE 3000
CMD ["node", "standalone/server.js"]
