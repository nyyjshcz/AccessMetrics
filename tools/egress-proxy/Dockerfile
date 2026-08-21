FROM node:24.19.0-bookworm-slim
LABEL org.opencontainers.image.title="accesscheck-egress-proxy"
RUN groupadd --system proxy && useradd --system --gid proxy --no-create-home proxy
WORKDIR /app
COPY proxy.mjs acl.yaml ./
USER proxy
EXPOSE 8080
CMD ["node", "proxy.mjs"]
