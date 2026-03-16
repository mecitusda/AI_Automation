import axios from "axios";

export default {
  type: "http",
  label: "HTTP Request",
  category: "data",
  schema: [
    { key: "url", type: "string", label: "URL", required: true, placeholder: "https://api.example.com/posts" },
    {
      key: "method",
      type: "select",
      label: "Method",
      default: "GET",
      options: [
        { value: "GET", label: "GET" },
        { value: "POST", label: "POST" },
        { value: "PUT", label: "PUT" },
        { value: "PATCH", label: "PATCH" },
        { value: "DELETE", label: "DELETE" },
      ],
    },
    { key: "headers", type: "json", label: "Headers", placeholder: "{}" },
    { key: "body", type: "json", label: "Body", placeholder: "{}" },
  ],
  output: {
    type: "object",
    properties: {
      status: { type: "number" },
      data: {},
      headers: {},
    },
  },
  executor: async ({ params, signal }) => {
    if (!params?.url) {
      throw new Error("URL is required");
    }
    const response = await axios({
      url: params.url,
      method: params.method || "GET",
      data: params.body,
      headers: params.headers || {},
      signal,
    });
    return {
      success: true,
      output: {
        status: response.status,
        data: response.data,
        headers: response.headers,
      },
    };
  },
  validate: (params) => {
    const err = {};
    if (!params?.url || String(params.url).trim() === "") err.url = "URL is required";
    return err;
  },
  summaryTemplate: "{{ method }} {{ url }}",
};
