export const taskPlugin = {
  name: "task",

  async execute({ params }) {
    return {
      success: true,
      output: params ?? {}
    };
  }
};