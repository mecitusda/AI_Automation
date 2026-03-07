import axios from "axios";

export default {
  async execute({ params, previousOutput, signal }) {

    if (!params?.url) {
      throw new Error("URL is required");
    }

    const response = await axios.get(params.url, {
      signal  
    });

    return {
      status: response.status,
      data: response.data
    };
  }
};