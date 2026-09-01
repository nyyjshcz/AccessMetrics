:80 {
  encode gzip

  reverse_proxy web:3000 {
    header_up -X-AccessCheck-Trusted-Proxy
    header_up X-AccessCheck-Trusted-Proxy caddy
    # Tailscale Funnel terminates public HTTPS before traffic reaches this
    # local HTTP listener. Preserve the browser-facing scheme for Next.js.
    header_up X-Forwarded-Proto https
  }

  header {
    X-Content-Type-Options nosniff
    Referrer-Policy no-referrer
  }
}
