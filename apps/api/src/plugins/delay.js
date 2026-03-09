export default {
  name: "delay",
  async execute({ params, signal }) {
    const ms = params?.ms ?? 10000;

    console.log(`[DELAY] Started for ${ms} ms`);
    const start = Date.now();
    await new Promise((resolve, reject) => {
      
      const timeout = setTimeout(() => {
        console.log("[DELAY] Finished normally");
        resolve();
      }, ms);

      if (signal) {
        signal.addEventListener("abort", () => {
          console.log("[DELAY] ABORTED and timeout for aborted: ",Date.now() - start);
          clearTimeout(timeout);
          reject(new Error("Timeout exceeded"));
        });
      }
    });

    return { delayed: ms };
  }
};