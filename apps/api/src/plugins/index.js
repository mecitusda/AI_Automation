import httpRequest from "./http.request.js";
import aiSummarize from "./ai.summarize.js";
import delay from "./delay.js";


export const plugins = {
  "http.request": httpRequest,
  "ai.summarize": aiSummarize,
  "delay": delay
};