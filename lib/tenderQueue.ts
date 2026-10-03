import { getChannel } from "@/lib/rabbitmq";
import { QUEUES } from "@/lib/queueConfig";

export type CostingAttachmentParsingPayload = {
  type: "COSTING_ATTACHMENT_PARSING";
  referenceNo: string;
  /** Routing key for the automation-v2 webhook. Read from AUTOMATION_V2_CLIENT_ID. */
  client_id?: string;
  /** External (Drive/AppSheet) files use this. */
  file_link?: string;
  /** Network files use file_type: "network" + decrypted_fileId ("costing|<rel>"). */
  file_type?: "network" | "external";
  decrypted_fileId?: string;
  sender?: "laser_cost";
  timestamp?: number;
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