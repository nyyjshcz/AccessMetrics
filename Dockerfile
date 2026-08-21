FROM node:24.19.0-bookworm-slim
ARG ACCESSCHECK_FINAL_CANDIDATE
ARG ACCESSCHECK_RC_COMMIT
ARG ACCESSCHECK_VERIFIED_TREE_HASH
ARG ACCESSCHECK_FULL_GATE_BUNDLE_HASH
ARG ACCESSCHECK_VALIDATION_ATTESTATION_HASH
ARG ACCESSCHECK_BUILT_AT
ARG ACCESSCHECK_BUILDER_VERSION
LABEL org.opencontainers.image.revision=$ACCESSCHECK_FINAL_CANDIDATE
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN if [ -n "$ACCESSCHECK_FINAL_CANDIDATE" ]; then node scripts/write-build-provenance.mjs /app/build-provenance.json; fi
COPY .next/standalone ./standalone
COPY .next/static ./standalone/.next/static
COPY public ./standalone/public
COPY scripts/healthcheck.mjs ./scripts/healthcheck.mjs
RUN mkdir -p /app/data /app/artifacts/private /app/artifacts/public
EXPOSE 3000
CMD ["node", "standalone/server.js"]
