import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { branches, inventory, reservations } from "./db/schema";
import {
  inventoryReservationsTotal,
  metricsResponse,
  withHttpObservability,
} from "./observability.js";

const branchResponse = t.Object({
  code: t.String(),
  name: t.String(),
  city: t.String(),
  address: t.String(),
});

const inventoryResponse = t.Object({
  lensId: t.String({ format: "uuid" }),
  branchCode: t.String(),
  branchName: t.String(),
  city: t.String(),
  address: t.String(),
  totalQuantity: t.Numeric(),
  availableQuantity: t.Numeric(),
});

const reservationResponse = t.Object({
  success: t.Boolean(),
  orderId: t.String({ format: "uuid" }),
  lensId: t.String({ format: "uuid" }),
  branchCode: t.String(),
  quantity: t.Numeric(),
  availableQuantity: t.Numeric(),
});

const releaseResponse = t.Object({
  success: t.Boolean(),
  orderId: t.String({ format: "uuid" }),
  released: t.Boolean(),
});

const errorResponse = t.Object({
  error: t.String(),
});

const app = new Elysia()
  .use(cors())
  .use(
    swagger({
      documentation: {
        info: {
          title: "SuiLens Inventory Service API",
          version: "1.0.0",
          description: "Branch inventory and stock reservation endpoints.",
        },
        tags: [
          { name: "Inventory", description: "Inventory query and reservation" },
        ],
      },
      path: "/docs",
    }),
  )
  .get(
    "/api/branches",
    withHttpObservability("/api/branches", async () => db.select().from(branches)),
    {
      detail: {
        tags: ["Inventory"],
        summary: "List branches",
      },
      response: {
        200: t.Array(branchResponse),
      },
    },
  )
  .get(
    "/api/inventory/lenses/:lensId",
    withHttpObservability("/api/inventory/lenses/:lensId", async (ctx: any) => {
      const { params } = ctx;
      const rows = await db
        .select({
          lensId: inventory.lensId,
          branchCode: inventory.branchCode,
          branchName: branches.name,
          city: branches.city,
          address: branches.address,
          totalQuantity: inventory.totalQuantity,
          availableQuantity: inventory.availableQuantity,
        })
        .from(inventory)
        .innerJoin(branches, eq(inventory.branchCode, branches.code))
        .where(eq(inventory.lensId, params.lensId));

      return rows;
    }),
    {
      detail: {
        tags: ["Inventory"],
        summary: "Get branch inventory for a lens",
      },
      params: t.Object({
        lensId: t.String({ format: "uuid" }),
      }),
      response: {
        200: t.Array(inventoryResponse),
      },
    },
  )
  .post(
    "/api/inventory/reserve",
    withHttpObservability("/api/inventory/reserve", async (ctx: any) => {
      const { body, status } = ctx;
      const existingReservation = await db
        .select()
        .from(reservations)
        .where(eq(reservations.orderId, body.orderId));

      if (existingReservation[0]?.status === "active") {
        const existingInventory = await db
          .select()
          .from(inventory)
          .where(
            and(
              eq(inventory.lensId, body.lensId),
              eq(inventory.branchCode, body.branchCode),
            ),
          );

        return {
          success: true,
          orderId: body.orderId,
          lensId: body.lensId,
          branchCode: body.branchCode,
          quantity: body.quantity,
          availableQuantity: existingInventory[0]?.availableQuantity ?? 0,
        };
      }

      if (existingReservation[0]) {
        inventoryReservationsTotal.labels("failed", "duplicate").inc();
        return status(409, {
          error: "Inventory reservation already exists for this order",
        });
      }

      return db.transaction(async (tx) => {
        const stockRows = await tx
          .select()
          .from(inventory)
          .where(
            and(
              eq(inventory.lensId, body.lensId),
              eq(inventory.branchCode, body.branchCode),
            ),
          );

        const stock = stockRows[0];

        if (!stock) {
          inventoryReservationsTotal.labels("failed", "not_found").inc();
          return status(404, { error: "Inventory record not found" });
        }

        if (stock.availableQuantity < body.quantity) {
          inventoryReservationsTotal.labels("failed", "insufficient_stock").inc();
          return status(409, {
            error: "Selected branch does not have enough stock",
          });
        }

        const [updatedStock] = await tx
          .update(inventory)
          .set({
            availableQuantity: stock.availableQuantity - body.quantity,
          })
          .where(eq(inventory.id, stock.id))
          .returning();

        await tx.insert(reservations).values({
          orderId: body.orderId,
          lensId: body.lensId,
          branchCode: body.branchCode,
          quantity: body.quantity,
        });

        inventoryReservationsTotal.labels("success", "reserved").inc();

        return {
          success: true,
          orderId: body.orderId,
          lensId: body.lensId,
          branchCode: body.branchCode,
          quantity: body.quantity,
          availableQuantity: updatedStock?.availableQuantity ?? 0,
        };
      });
    }),
    {
      detail: {
        tags: ["Inventory"],
        summary: "Reserve stock for an order",
      },
      body: t.Object({
        orderId: t.String({ format: "uuid" }),
        lensId: t.String({ format: "uuid" }),
        branchCode: t.String(),
        quantity: t.Numeric(),
      }),
      response: {
        200: reservationResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  )
  .post(
    "/api/inventory/release",
    withHttpObservability("/api/inventory/release", async (ctx: any) => {
      const { body } = ctx;
      return db.transaction(async (tx) => {
        const reservationRows = await tx
          .select()
          .from(reservations)
          .where(eq(reservations.orderId, body.orderId));

        const reservation = reservationRows[0];

        if (!reservation || reservation.status === "released") {
          return {
            success: true,
            orderId: body.orderId,
            released: false,
          };
        }

        const stockRows = await tx
          .select()
          .from(inventory)
          .where(
            and(
              eq(inventory.lensId, reservation.lensId),
              eq(inventory.branchCode, reservation.branchCode),
            ),
          );

        const stock = stockRows[0];

        if (stock) {
          await tx
            .update(inventory)
            .set({
              availableQuantity: stock.availableQuantity + reservation.quantity,
            })
            .where(eq(inventory.id, stock.id));
        }

        await tx
          .update(reservations)
          .set({
            status: "released",
            releasedAt: new Date(),
          })
          .where(eq(reservations.id, reservation.id));

        return {
          success: true,
          orderId: body.orderId,
          released: true,
        };
      });
    }),
    {
      detail: {
        tags: ["Inventory"],
        summary: "Release stock reservation",
      },
      body: t.Object({
        orderId: t.String({ format: "uuid" }),
      }),
      response: {
        200: releaseResponse,
      },
    },
  )
  .get(
    "/health",
    withHttpObservability("/health", () => ({
      status: "ok",
      service: "inventory-service",
    })),
    {
      detail: {
        tags: ["Inventory"],
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
        tags: ["Inventory"],
        summary: "Prometheus metrics",
      },
    },
  )
  .listen(3004);

console.log(`Inventory Service running on port ${app.server?.port}`);
