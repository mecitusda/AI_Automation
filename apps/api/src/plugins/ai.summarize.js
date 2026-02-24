export default {
  async execute({ previousOutput }) {

    if (!previousOutput) {
      return "Nothing to summarize";
    }

    return `Summary: ${JSON.stringify(previousOutput).slice(0, 100)}...`;
  }
};