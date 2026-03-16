import { Template } from "../models/template.model.js";

const EXAMPLE_TEMPLATES = [
  {
    name: "AI Support Ticket Router",
    description: "Classify incoming support tickets with AI, then route urgent ones to Slack and others to email queue.",
    category: "AI",
    workflow: {
      name: "AI Support Ticket Router",
      enabled: true,
      maxParallel: 3,
      trigger: { type: "manual" },
      steps: [
        { id: "classify", type: "openai", params: { prompt: "Reply with only one word: urgent or normal. Ticket: {{ trigger.body }}", model: "gpt-4o-mini" }, dependsOn: [] },
        { id: "branch", type: "if", params: { condition: "{{ steps.classify.0.output }}==urgent", thenGoto: "slackAlert", elseGoto: "emailQueue" }, dependsOn: ["classify"] },
        { id: "slackAlert", type: "slack", params: { channel: "#alerts", text: "Urgent ticket: {{ trigger.body }}" }, dependsOn: ["branch"] },
        { id: "emailQueue", type: "email", params: { to: "queue@example.com", subject: "Ticket", body: "{{ trigger.body }}" }, dependsOn: ["branch"] }
      ]
    }
  },
  {
    name: "GitHub Issue Analyzer",
    description: "Fetch a GitHub issue, analyze it with AI, generate a list of developer tasks, then log each task.",
    category: "AI",
    workflow: {
      name: "GitHub Issue Analyzer",
      enabled: true,
      maxParallel: 3,
      trigger: { type: "manual" },
      steps: [
        { id: "fetchIssue", type: "http", params: { method: "GET", url: "https://api.github.com/repos/facebook/react/issues/1", headers: { "User-Agent": "automation-engine" } }, dependsOn: [] },
        { id: "analyzeIssue", type: "openai", params: { model: "gpt-4o-mini", prompt: "Analyze this GitHub issue: {{ steps.fetchIssue.0.output.data.title }}\n\n{{ steps.fetchIssue.0.output.data.body }}" }, dependsOn: ["fetchIssue"] },
        { id: "generateTasks", type: "openai", params: { model: "gpt-4o-mini", prompt: "Based on the analysis, list developer tasks as a JSON array of strings." }, dependsOn: ["analyzeIssue"] },
        { id: "loopTasks", type: "foreach", params: { items: "{{ steps.generateTasks.0.output }}" }, dependsOn: ["generateTasks"] },
        { id: "logTask", type: "log", params: { message: "Developer task: {{ loop.item }}" }, dependsOn: ["loopTasks"] }
      ]
    }
  },
  {
    name: "AI Article Summarizer",
    description: "Fetch an article via URL, summarize it with AI, then extract bullet points and iterate over them.",
    category: "AI",
    workflow: {
      name: "AI Article Summarizer",
      enabled: true,
      maxParallel: 3,
      trigger: { type: "manual" },
      steps: [
        { id: "fetchArticle", type: "http", params: { method: "GET", url: "{{ trigger.url }}" }, dependsOn: [] },
        { id: "summarize", type: "openai", params: { model: "gpt-4o-mini", prompt: "Summarize this article in 2-3 sentences: {{ steps.fetchArticle.0.output.data }}" }, dependsOn: ["fetchArticle"] },
        { id: "extractBullets", type: "openai", params: { model: "gpt-4o-mini", prompt: "Extract key bullet points from this summary as a JSON array of strings: {{ steps.summarize.0.output }}" }, dependsOn: ["summarize"] },
        { id: "loopBullets", type: "foreach", params: { items: "{{ steps.extractBullets.0.output }}" }, dependsOn: ["extractBullets"] },
        { id: "logBullet", type: "log", params: { message: "Bullet: {{ loop.item }}" }, dependsOn: ["loopBullets"] }
      ]
    }
  }
];

export async function seedTemplatesIfEmpty() {
  const count = await Template.countDocuments();
  if (count > 0) return;
  await Template.insertMany(EXAMPLE_TEMPLATES);
  console.log("Seeded", EXAMPLE_TEMPLATES.length, "templates");
}
