# Security Boundaries

> **Who should read this: deployment owners. Is it required: required for the deployment path, optional for other roles.** This page records only the access, scan-target, key, and report-publication boundaries actually enforced by the current code.

Language: [中文版](./安全边界.md)

## Access keys

The administrator key allows creating scans, configuring AI, handling incomplete items, publishing reports, and deleting unpublished terminal-state tasks. The visitor key can only read published reports. `SESSION_SECRET` is an internal server key used to sign session Cookies and encrypt saved Provider Keys; it is not given to users.

Keys are read only from environment variables or Docker secret files. Administrator and visitor keys must differ and be at least 16 characters; do not commit them to Git, logs, or public export directories.

## Requests and scan targets

Write requests with an `Origin` must be same-origin with `APP_BASE_URL`. Login requests must also be same-origin. Scan targets accept only HTTP/HTTPS and disallow credential URLs, localhost, private networks, loopback, cloud metadata hostnames, and other reserved addresses. The crawler is limited to same-origin pages by default, and cross-origin redirects are rejected.

The production scanning Worker must make outbound connections through an explicit `EGRESS_PROXY_URL`. The Web app may use a separate browser egress path for PDF rendering, but it cannot use that path to bypass the scanning Worker's proxy requirement.

## Other runtime protections

The create-scan endpoint has in-process rate limiting and accepts `idempotency-key` to prevent a user from submitting the same task repeatedly. This only reduces duplicate requests within the current process and cannot replace rate limiting at the network layer.

Login attempts are rate-limited for a short period per client. After a successful login, the server writes a 7-day `HttpOnly`, `SameSite=Lax` Cookie; production also enables `Secure`. Responses include common browser security headers. AI Provider requests do not automatically follow redirects, and logs hide common credential fields.

## Reports and data

Published runs are read-only. Public reports may read only completed scans that are not in an active AI batch. Private evidence, the database, manual notes, and Provider Keys should not be mounted as public resources.

These measures do not replace network isolation, container sandboxing, key rotation, or authorization from target websites. See [Deployment instructions](./ops/deployment.en.md) for the complete deployment steps.
