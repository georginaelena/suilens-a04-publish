import amqplib from "amqplib";
import { db } from "./db";
import { notifications } from "./db/schema";
import { broadcastNotification } from "./realtime";
import {
  consumedEventsTotal,
  logError,
  logInfo,
  notificationsTotal,
  withMessageTrace,
} from "./observability.js";

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const EXCHANGE_NAME = "suilens.events";
const QUEUE_NAME = "notification-service.order-events";

export async function startConsumer() {
  let retries = 0;
  const maxRetries = 10;
  const retryDelay = 2000;

  while (retries < maxRetries) {
    try {
      const connection = await amqplib.connect(RABBITMQ_URL);
      const channel = await connection.createChannel();

      await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });
      await channel.assertQueue(QUEUE_NAME, { durable: true });
      await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, "order.*");

      logInfo("consumer.started", { queue: QUEUE_NAME, exchange: EXCHANGE_NAME });

      channel.consume(QUEUE_NAME, async (msg) => {
        if (!msg) return;

        try {
          const event = JSON.parse(msg.content.toString());
          const messageHeaders = (msg.properties.headers || {}) as Record<string, string>;
          const correlationId =
            typeof messageHeaders["x-correlation-id"] === "string"
              ? messageHeaders["x-correlation-id"]
              : undefined;

          await withMessageTrace(event.event, messageHeaders, async () => {
            consumedEventsTotal.labels(event.event, "success").inc();

            logInfo("event.received", {
              event: event.event,
              correlation_id: correlationId,
              queue: QUEUE_NAME,
            });

            if (event.event === "order.placed") {
              const { orderId, customerName, customerEmail, lensName } =
                event.data;

              const [notification] = await db
                .insert(notifications)
                .values({
                  orderId,
                  type: "order_placed",
                  recipient: customerEmail,
                  message: `Hi ${customerName}, your rental order for ${lensName} has been placed successfully. Order ID: ${orderId}`,
                  payload: event.data,
                })
                .returning();

              if (notification) {
                notificationsTotal.labels("order_placed", "success").inc();

                broadcastNotification({
                  type: "notification.created",
                  notification: {
                    id: notification.id,
                    orderId: notification.orderId,
                    event: event.event,
                    recipient: notification.recipient,
                    message: notification.message,
                    payload: notification.payload as {
                      orderId: string;
                      customerName: string;
                      customerEmail: string;
                      lensName: string;
                      branchCode?: string;
                      quantity?: number;
                    },
                    sentAt: notification.sentAt.toISOString(),
                  },
                });

                logInfo("notification.created", {
                  event: event.event,
                  order_id: orderId,
                  recipient: customerEmail,
                  correlation_id: correlationId,
                });
              }
            }
          });

          channel.ack(msg);
        } catch (error) {
          const eventName = (() => {
            try {
              const parsed = JSON.parse(msg.content.toString());
              return parsed.event || "unknown";
            } catch {
              return "unknown";
            }
          })();

          consumedEventsTotal.labels(eventName, "failed").inc();
          logError("event.processing_failed", {
            event: eventName,
            error: error instanceof Error ? error.message : String(error),
          });
          channel.nack(msg, false, true);
        }
      });

      return;
    } catch (error) {
      retries++;
      logError("consumer.connect_failed", {
        attempt: retries,
        max_retries: maxRetries,
        error: (error as Error).message,
      });
      if (retries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  logError("consumer.disabled", {
    reason: "Failed to connect to RabbitMQ after maximum retries",
  });
}
