export default {
  name: "ai.summarize",
  async execute({ previousOutput, signal }) {

    if (signal?.aborted) {
      throw new Error("Cancelled");
    }

    if (!previousOutput) {
      return "Nothing to summarize";
    }

    return `Summary: ${JSON.stringify(previousOutput).slice(0, 100)}...`;
  }
};