export const logPlugin = {
  name: "log",

  async execute({ params }) {
    console.log("PLUGIN LOG:", params?.message);

    return {
      success: true,
      output: { logged: true }
    };
  }
};