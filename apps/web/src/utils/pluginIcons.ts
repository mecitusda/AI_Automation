const ICONS: Record<string, string> = {
  http: "/icons/plugins/http.svg",
  openai: "/icons/plugins/openai.svg",
  "ai.summarize": "/icons/plugins/ai.svg",
  log: "/icons/plugins/log.svg",
  delay: "/icons/plugins/delay.svg",
  foreach: "/icons/plugins/flow.svg",
  if: "/icons/plugins/if.svg",
  email: "/icons/plugins/email.svg",
  slack: "/icons/plugins/slack.svg",
  code: "/icons/plugins/code.svg",
  merge: "/icons/plugins/flow.svg",
  parallel: "/icons/plugins/flow.svg",
  switch: "/icons/plugins/if.svg",
  task: "/icons/plugins/task.svg",
  transform: "/icons/plugins/transform.svg",
  template: "/icons/plugins/template.svg",
  setVariable: "/icons/plugins/variable.svg",
  "trigger.cron": "/icons/plugins/cron.svg",
  "telegram.message": "/icons/plugins/telegram.svg",
  "telegram.trigger": "/icons/plugins/telegram.svg",
  "webhook.response": "/icons/plugins/webhook.svg",
  unstable: "/icons/plugins/unstable.svg",
  "db.get": "/icons/plugins/database.svg",
  "db.set": "/icons/plugins/database.svg",
  "db.query": "/icons/plugins/database.svg",
  "db.delete": "/icons/plugins/database.svg",
};

export function getPluginIcon(type: string, category?: string): string {
  const icon = ICONS[type];
  if (icon) return icon;
  if (category === "ai") return "/icons/plugins/ai.svg";
  if (category === "data") return "/icons/plugins/database.svg";
  if (category === "control") return "/icons/plugins/flow.svg";
  return "/icons/plugins/default.svg";
}

export function isIconAsset(icon: string): boolean {
  return typeof icon === "string" && icon.startsWith("/");
}
