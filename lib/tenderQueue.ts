import { getChannel } from "@/lib/rabbitmq";
import { QUEUES } from "@/lib/queueConfig";

export type CostingAttachmentParsingPayload = {
  type: "COSTING_ATTACHMENT_PARSING";
  referenceNo: string;
  file_link: string;
  decrypted_fileId: string;
  file_type: "network" | "external";
  sender: "laser_cost";
  timestamp: number;
};

async function publishToQueue(
  queue: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const ch = await getChannel();
  if (!ch) {
    console.warn("[RabbitMQ] No channel — skipping publish");
    return false;
  }

  try {
    await ch.assertQueue(queue, { durable: true });
    const sent = ch.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), {
      persistent: true,
    });
    if (!sent) {
      console.warn("[RabbitMQ] Message not sent (backpressure)");
    }
    return sent;
  } catch (err) {
    console.error("[RabbitMQ] Failed to publish task:", err);
    return false;
  }
}

export async function publishTenderParsingTask(
  payload: CostingAttachmentParsingPayload
): Promise<boolean> {
  return publishToQueue(QUEUES.TENDER_PARSING, payload);
}
