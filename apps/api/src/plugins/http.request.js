import axios from "axios";

export default {
  async execute({ params, previousOutput }) {

    if (!params?.url) {
      throw new Error("URL is required");
    }

    const response = await axios.get(params.url);

    return {
      status: response.status,
      data: response.data
    };
  }
};