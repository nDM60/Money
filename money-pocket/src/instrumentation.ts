/** Optional in-process scheduler for self-hosted deployments (INTERNAL_SCHEDULER=true). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
