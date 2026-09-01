FROM node:24.19.0-bookworm-slim
LABEL org.opencontainers.image.title="accesscheck-egress-proxy"
RUN set -eux; \
    if ! getent group proxy >/dev/null; then groupadd --system proxy; fi; \
    if ! getent passwd proxy >/dev/null; then useradd --system --gid proxy --no-create-home proxy; fi
WORKDIR /app
COPY proxy.mjs acl.yaml ./
USER proxy
EXPOSE 8080
CMD ["node", "proxy.mjs"]
