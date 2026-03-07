import httpRequest from "./http.request.js";
import aiSummarize from "./ai.summarize.js";
import delay from "./delay.js";
import { taskPlugin } from "./task.js";
import { unstablePlugin } from "./unstable.js";
import { logPlugin } from "./log.js";
export const plugins = {
  "http.request": httpRequest,
  "ai.summarize": aiSummarize,
  "delay": delay,
  "task": taskPlugin,
  "unstable": unstablePlugin,
  "log": logPlugin
};