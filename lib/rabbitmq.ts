import amqp, { type Channel, type ChannelModel } from "amqplib";

const globalForAmqp = globalThis as unknown as {
  rabbitmqConnection?: ChannelModel;
  rabbitmqChannel?: Channel;
};

async function createChannel(): Promise<Channel | null> {
  const url = process.env.RABBITMQ_URL;
  if (!url) {
    console.warn("[RabbitMQ] RABBITMQ_URL is not set; cannot connect.");
    return null;
  }
  try {
    const conn = await amqp.connect(url);
    const ch = await conn.createChannel();
    conn.on("close", () => {
      globalForAmqp.rabbitmqConnection = undefined;
      globalForAmqp.rabbitmqChannel = undefined;
    });
    globalForAmqp.rabbitmqConnection = conn;
    globalForAmqp.rabbitmqChannel = ch;
    return ch;
  } catch (err) {
    console.error("[RabbitMQ] Failed to connect:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function getChannel(): Promise<Channel | null> {
  if (globalForAmqp.rabbitmqChannel) return globalForAmqp.rabbitmqChannel;
  return createChannel();
}
