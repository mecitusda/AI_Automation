import axios from "axios";

export default {
  name: "http",

  async execute({ params, previousOutput, signal }) {

    if (!params?.url) {
      throw new Error("URL is required");
    }

    const response = await axios({
      url: params.url,
      method: params.method || "GET",
      data: params.body,
      headers: params.headers || {},
      signal
    });

    return {
      success: true,
      output: {
        status: response.status,
        data: response.data,
        headers: response.headers
      }
    };
  }
};