FROM node:24.19.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@11.19.0 --activate \
    && pnpm install --frozen-lockfile --prod=false
RUN pnpm exec playwright install --with-deps chromium && chmod -R a+rx /ms-playwright
COPY . .
RUN pnpm build
# `.next/` is excluded from the Docker build context, so copy the standalone
# output from the build stage's filesystem instead of asking Docker to read it
# from the host context. Next's standalone server does not include these two
# asset directories by default.
RUN cp -r .next/standalone ./standalone \
    && cp -r .next/static ./standalone/.next/ \
    && cp -r public ./standalone/public
COPY scripts/healthcheck.mjs ./scripts/healthcheck.mjs
RUN mkdir -p /app/data /app/artifacts/private /app/artifacts/public
# The runtime containers intentionally use non-root UIDs.  Make the checked-in
# application, standalone output, and static assets readable/traversable while
# keeping runtime data on the mounted volumes.  Skip node_modules: its package
# files already have standard readable modes, and walking it here is very slow
# on the NAS overlay filesystem.
RUN find /app \( -path /app/node_modules -o -path /app/standalone/node_modules \) -prune -o -type d -exec chmod a+rx {} + \
    && find /app \( -path /app/node_modules -o -path /app/standalone/node_modules \) -prune -o -type f -exec chmod a+r {} +
EXPOSE 3000
CMD ["node", "standalone/server.js"]
