if (process.env.INTERNAL_SCHEDULER === "true") {
  const every = Math.max(1, Number(process.env.SCHEDULER_INTERVAL_MIN ?? 5)) * 60_000;
  const run = async () => {
    try {
      const { runTick } = await import("./server/services/scheduler");
      await runTick();
    } catch (e) {
      console.error("scheduler tick failed", e);
    }
  };
  setTimeout(run, 15_000);
  setInterval(run, every);
}
export {};
