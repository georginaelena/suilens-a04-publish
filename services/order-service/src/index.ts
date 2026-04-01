import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { db } from "./db";
import { orders } from "./db/schema";
import { eq } from "drizzle-orm";
import { publishEvent } from "./events";
import { releaseInventory, reserveInventory } from "./inventory";
import {
  injectTraceContext,
  logError,
  logInfo,
  metricsResponse,
  orderEventsPublishedTotal,
  ordersTotal,
  reservationAttemptsTotal,
  tracedFetch,
  withHttpObservability,
} from "./observability.js";

const CATALOG_SERVICE_URL =
  process.env.CATALOG_SERVICE_URL || "http://localhost:3001";
const DEFAULT_BRANCH_CODE = process.env.DEFAULT_BRANCH_CODE || "KB-JKT-S";

interface CatalogLens {
  id: string;
  modelName: string;
  manufacturerName: string;
  dayPrice: string;
}

const orderLensSnapshot = t.Object({
  modelName: t.String(),
  manufacturerName: t.String(),
  dayPrice: t.String(),
});

const orderResponse = t.Object({
  id: t.String({ format: "uuid" }),
  customerName: t.String(),
  customerEmail: t.String({ format: "email" }),
  lensId: t.String({ format: "uuid" }),
  branchCode: t.String(),
  quantity: t.Numeric(),
  lensSnapshot: orderLensSnapshot,
  startDate: t.String(),
  endDate: t.String(),
  totalPrice: t.String(),
  status: t.String(),
  createdAt: t.String(),
});

const errorResponse = t.Object({
  error: t.String(),
});

function serializeOrder(order: typeof orders.$inferSelect) {
  return {
    ...order,
    lensSnapshot: order.lensSnapshot as {
      modelName: string;
      manufacturerName: string;
      dayPrice: string;
    },
    startDate: order.startDate.toISOString(),
    endDate: order.endDate.toISOString(),
    createdAt: order.createdAt.toISOString(),
  };
}

const app = new Elysia()
  .use(cors())
  .use(
    swagger({
      documentation: {
        info: {
          title: "SuiLens Order Service API",
          version: "1.0.0",
          description: "Order creation and lookup endpoints for SuiLens.",
        },
        tags: [{ name: "Orders", description: "Rental order operations" }],
      },
      path: "/docs",
    }),
  )
  .post(
    "/api/orders",
    withHttpObservability("/api/orders", async (ctx: any, obs: any) => {
      const { body, status } = ctx;
      const propagationHeaders = injectTraceContext({
        "x-correlation-id": obs.correlationId,
      });

      const lensResponse = await tracedFetch(
        `${CATALOG_SERVICE_URL}/api/lenses/${body.lensId}`,
        {
          headers: propagationHeaders,
        },
        {
          "peer.service": "catalog-service",
          "http.route": "/api/lenses/:id",
        },
      );

      if (!lensResponse.ok) {
        ordersTotal.labels("failed", "lens_not_found").inc();
        return status(404, { error: "Lens not found" });
      }
      const lens = (await lensResponse.json()) as CatalogLens;

      const start = new Date(body.startDate);
      const end = new Date(body.endDate);
      const days = Math.ceil(
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (days <= 0) {
        ordersTotal.labels("failed", "invalid_date_range").inc();
        return status(400, { error: "End date must be after start date" });
      }
      const totalPrice = (days * parseFloat(lens.dayPrice)).toFixed(2);
      const branchCode = body.branchCode || DEFAULT_BRANCH_CODE;
      const quantity = 1;
      const orderId = crypto.randomUUID();

      const reservation = await reserveInventory({
        orderId,
        lensId: body.lensId,
        branchCode,
        quantity,
      }, propagationHeaders);

      if (!reservation.ok) {
        reservationAttemptsTotal.labels("failed").inc();
        ordersTotal.labels("failed", "inventory_reservation_failed").inc();
        return status(reservation.status, { error: reservation.error });
      }

      reservationAttemptsTotal.labels("success").inc();

      const [order] = await db
        .insert(orders)
        .values({
          id: orderId,
          customerName: body.customerName,
          customerEmail: body.customerEmail,
          lensId: body.lensId,
          branchCode,
          quantity,
          lensSnapshot: {
            modelName: lens.modelName,
            manufacturerName: lens.manufacturerName,
            dayPrice: lens.dayPrice,
          },
          startDate: start,
          endDate: end,
          totalPrice,
        })
        .returning();
      if (!order) {
        await releaseInventory(orderId, propagationHeaders);
        ordersTotal.labels("failed", "db_insert_failed").inc();
        return status(500, { error: "Failed to create order" });
      }

      await publishEvent("order.placed", {
        orderId: order.id,
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        lensName: lens.modelName,
        branchCode,
        quantity,
      }, { correlationId: obs.correlationId });

      orderEventsPublishedTotal.labels("order.placed", "success").inc();
      ordersTotal.labels("success", "created").inc();

      logInfo("order.created", {
        order_id: order.id,
        lens_id: body.lensId,
        branch_code: branchCode,
        customer_email: body.customerEmail,
        correlation_id: obs.correlationId,
      });

      return status(201, serializeOrder(order));
    }),
    {
      detail: {
        tags: ["Orders"],
        summary: "Create order",
        description:
          "Creates a rental order after validating the requested lens against the catalog service.",
      },
      body: t.Object({
        customerName: t.String(),
        customerEmail: t.String({ format: "email" }),
        lensId: t.String({ format: "uuid" }),
        branchCode: t.Optional(t.String()),
        startDate: t.String(),
        endDate: t.String(),
      }),
      response: {
        201: orderResponse,
        400: errorResponse,
        404: errorResponse,
        409: errorResponse,
        500: errorResponse,
      },
    },
  )
  .get(
    "/api/orders",
    withHttpObservability("/api/orders", async () => {
      const results = await db.select().from(orders);
      return results.map(serializeOrder);
    }),
    {
      detail: {
        tags: ["Orders"],
        summary: "List orders",
      },
      response: {
        200: t.Array(orderResponse),
      },
    },
  )
  .get(
    "/api/orders/:id",
    withHttpObservability("/api/orders/:id", async (ctx: any) => {
      const { params, status } = ctx;
      const results = await db
        .select()
        .from(orders)
        .where(eq(orders.id, params.id));
      if (!results[0]) {
        return status(404, { error: "Order not found" });
      }
      return serializeOrder(results[0]);
    }),
    {
      detail: {
        tags: ["Orders"],
        summary: "Get order by ID",
      },
      params: t.Object({
        id: t.String({ format: "uuid" }),
      }),
      response: {
        200: orderResponse,
        404: errorResponse,
      },
    },
  )
  .get(
    "/health",
    withHttpObservability("/health", () => ({
      status: "ok",
      service: "order-service",
    })),
    {
      detail: {
        tags: ["Orders"],
        summary: "Health check",
      },
      response: {
        200: t.Object({
          status: t.String(),
          service: t.String(),
        }),
      },
    },
  )
  .get(
    "/metrics",
    withHttpObservability("/metrics", async () => metricsResponse()),
    {
      detail: {
        tags: ["Orders"],
        summary: "Prometheus metrics",
      },
    },
  )
  .listen(3002);

console.log(`Order Service running on port ${app.server?.port}`);
