// Runs once when the Next.js server starts (not during `next build`).
export async function register() {
  // Keep this as a positive `=== "nodejs"` check wrapping the import: Next also
  // compiles this file for the edge runtime, and only this form lets it drop the
  // import there (the scheduler pulls in pg/Prisma, which cannot build for edge).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
