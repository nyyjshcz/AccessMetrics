/**
 * Next calls register once before the server starts accepting requests. Keep
 * the production Web checks here so importing config remains side-effect free
 * for migrations, scripts, tests, and the isolated scan worker.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertWebStartup } = await import("./lib/startup");
    assertWebStartup();
  }
}
