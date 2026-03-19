export default {
  type: "trigger.cron",
  label: "Cron",
  category: "trigger",
  trigger: true,
  schema: [
    { key: "cron", type: "string", label: "Cron expression", required: true, placeholder: "0 9 * * *" },
    { key: "timezone", type: "string", label: "Timezone (optional)", placeholder: "Europe/Istanbul" }
  ]
};
