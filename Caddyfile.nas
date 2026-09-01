:80 {
  encode gzip

  reverse_proxy web:3000 {
    header_up -X-AccessCheck-Trusted-Proxy
    header_up X-AccessCheck-Trusted-Proxy caddy
  }

  header {
    X-Content-Type-Options nosniff
    Referrer-Policy no-referrer
  }
}
