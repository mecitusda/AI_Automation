export default {
  async execute({ params }) {
    const ms = params?.ms ?? 10000;

    console.log(`Delaying for ${ms} ms`);

    await new Promise((resolve) => setTimeout(resolve, ms));

    return { delayed: ms };
  }
};