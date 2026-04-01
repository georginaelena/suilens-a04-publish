import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { db } from "./db";
import { lenses } from "./db/schema";
import { eq } from "drizzle-orm";
import {
  catalogReadTotal,
  metricsResponse,
  withHttpObservability,
} from "./observability.js";

const lensResponse = t.Object({
  id: t.String({ format: "uuid" }),
  modelName: t.String(),
  manufacturerName: t.String(),
  minFocalLength: t.Numeric(),
  maxFocalLength: t.Numeric(),
  maxAperture: t.String(),
  mountType: t.String(),
  dayPrice: t.String(),
  weekendPrice: t.String(),
  description: t.Nullable(t.String()),
});

const errorResponse = t.Object({
  error: t.String(),
});

function serializeLens(lens: typeof lenses.$inferSelect) {
  return {
    ...lens,
    maxAperture: String(lens.maxAperture),
    dayPrice: String(lens.dayPrice),
    weekendPrice: String(lens.weekendPrice),
  };
}

const app = new Elysia()
  .use(cors())
  .use(
    swagger({
      documentation: {
        info: {
          title: "SuiLens Catalog Service API",
          version: "1.0.0",
          description: "Catalog endpoints for browsing SuiLens lenses.",
        },
        tags: [{ name: "Catalog", description: "Lens catalog operations" }],
      },
      path: "/docs",
    }),
  )
  .get(
    "/api/lenses",
    withHttpObservability("/api/lenses", async () => {
      const results = await db.select().from(lenses);
      catalogReadTotal.labels("list").inc();
      return results.map(serializeLens);
    }),
    {
      detail: {
        tags: ["Catalog"],
        summary: "List lenses",
        description: "Returns all rentable lenses in the catalog.",
      },
      response: {
        200: t.Array(lensResponse),
      },
    },
  )
  .get(
    "/api/lenses/:id",
    withHttpObservability("/api/lenses/:id", async (ctx: any) => {
      const { params, status } = ctx;
      const results = await db
        .select()
        .from(lenses)
        .where(eq(lenses.id, params.id));
      if (!results[0]) {
        return status(404, { error: "Lens not found" });
      }
      catalogReadTotal.labels("by_id").inc();
      return serializeLens(results[0]);
    }),
    {
      detail: {
        tags: ["Catalog"],
        summary: "Get lens by ID",
        description: "Returns a single lens from the catalog.",
      },
      params: t.Object({
        id: t.String({ format: "uuid" }),
      }),
      response: {
        200: lensResponse,
        404: errorResponse,
      },
    },
  )
  .get(
    "/health",
    withHttpObservability("/health", () => ({
      status: "ok",
      service: "catalog-service",
    })),
    {
      detail: {
        tags: ["Catalog"],
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
        tags: ["Catalog"],
        summary: "Prometheus metrics",
      },
    },
  )
  .listen(3001);

console.log(`Catalog Service running on port ${app.server?.port}`);
