// Route integration tests intentionally exercise handlers directly rather than
// obtaining browser sessions. Real dev/production runs configure both access
// keys and therefore always require a signed session; this marker keeps the
// existing direct-handler test harness isolated from that policy.
process.env.APP_ENV ??= "test";
