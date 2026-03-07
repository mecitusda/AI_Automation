import amqp from "amqplib";

export let channel;

export async function connectRabbit() {
  const connection = await amqp.connect(process.env.RABBIT_URL);
  channel = await connection.createChannel();
  await channel.prefetch(5)
  await channel.assertExchange("automation.direct", "direct", { durable: true });


  await channel.assertQueue("run.start.q", { durable: true });
  await channel.bindQueue("run.start.q", "automation.direct", "run.start");

  await channel.assertQueue("step.execute.q", { durable: true });
  await channel.bindQueue("step.execute.q", "automation.direct", "step.execute");

  await channel.assertQueue("step.result.q", { durable: true });
  await channel.bindQueue("step.result.q", "automation.direct", "step.result");

  await channel.assertQueue("run.cancel.q", { durable: true });
  await channel.bindQueue("run.cancel.q", "automation.direct", "run.cancel");

  await channel.assertQueue("step.retry.q", {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": "automation.direct",
      // TTL dolunca worker'a değil orchestrator'a geri düşsün
      "x-dead-letter-routing-key": "step.retry.fire"
    }
  });
  await channel.assertQueue("step.retry.fire.q", { durable: true });
  await channel.bindQueue("step.retry.fire.q", "automation.direct", "step.retry.fire");

  await channel.assertQueue("step.timeout.q", {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": "automation.direct",
      "x-dead-letter-routing-key": "step.timeout.fire"
    }
  });

  await channel.assertQueue("step.timeout.fire.q", { durable: true });

  await channel.bindQueue(
    "step.timeout.fire.q",
    "automation.direct",
    "step.timeout.fire"
  );

  await channel.assertQueue("step.cancel.q", { durable: true });
  await channel.bindQueue("step.cancel.q", "automation.direct", "step.cancel");

  await channel.assertQueue("dispatch.kick.q", { durable: true });
  await channel.bindQueue("dispatch.kick.q", "automation.direct", "dispatch.kick");

  await channel.assertQueue("workflow.created.q", { durable: true });
  await channel.bindQueue(
    "workflow.created.q",
    "automation.direct",
    "workflow.created"
  );
  console.log("RabbitMQ connected");
}