export const unstablePlugin = {
  name: "unstable",

  async execute({ params }) {
    const failRate = params?.failRate ?? 0.7;

    if (Math.random() < failRate) {
      throw new Error("Random failure");
    }

    return {
      success: true,
      output: { ok: true }
    };
  }
};