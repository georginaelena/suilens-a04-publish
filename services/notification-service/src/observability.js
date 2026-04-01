import { context, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

const SERVICE_NAME = process.env.SERVICE_NAME || "notification-service";
const OTLP_ENDPOINT =
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
  "http://localhost:4318/v1/traces";

const provider = new NodeTracerProvider({
  spanProcessors: [
    new BatchSpanProcessor(new OTLPTraceExporter({ url: OTLP_ENDPOINT })),
  ],
});
provider.register();
propagation.setGlobalPropagator(new W3CTraceContextPropagator());

const tracer = trace.getTracer(SERVICE_NAME);
const register = new Registry();
collectDefaultMetrics({ register });

const httpRequestsTotal = new Counter({
  name: "suilens_http_requests_total",
  help: "Total number of HTTP requests.",
  labelNames: ["service", "method", "route", "status"],
  registers: [register],
});

const httpRequestDurationSeconds = new Histogram({
  name: "suilens_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds.",
  labelNames: ["service", "method", "route"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const notificationsTotal = new Counter({
  name: "suilens_notifications_total",
  help: "Total number of notifications created from events.",
  labelNames: ["type", "status"],
  registers: [register],
});

export const consumedEventsTotal = new Counter({
  name: "suilens_consumed_events_total",
  help: "Total number of RabbitMQ events consumed.",
  labelNames: ["event", "status"],
  registers: [register],
});

function nowIso() {
  return new Date().toISOString();
}

function getStatusCode(ctx, result) {
  const candidate = ctx?.set?.status;
  if (typeof candidate === "number") return candidate;
  if (typeof candidate === "string") {
    const parsed = Number.parseInt(candidate, 10);
    return Number.isNaN(parsed) ? 200 : parsed;
  }
  if (result instanceof Response) return result.status;
  return 200;
}

function log(level, message, fields = {}) {
  const activeSpan = trace.getActiveSpan();
  const spanContext = activeSpan ? activeSpan.spanContext() : null;

  const payload = {
    timestamp: nowIso(),
    service: SERVICE_NAME,
    level,
    message,
    ...fields,
  };

  if (spanContext) {
    payload.trace_id = spanContext.traceId;
    payload.span_id = spanContext.spanId;
  }

  console.log(JSON.stringify(payload));
}

export function logInfo(message, fields = {}) {
  log("info", message, fields);
}

export function logError(message, fields = {}) {
  log("error", message, fields);
}

export function withHttpObservability(route, handler) {
  return async (ctx) => {
    const method = ctx.request.method;
    const incomingCarrier = {};
    for (const [key, value] of ctx.request.headers.entries()) {
      incomingCarrier[key] = value;
    }

    const parentContext = propagation.extract(ROOT_CONTEXT, incomingCarrier);
    const serverSpan = tracer.startSpan(
      `${method} ${route}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          "service.name": SERVICE_NAME,
          "http.method": method,
          "http.route": route,
        },
      },
      parentContext,
    );

    const correlationId =
      ctx.request.headers.get("x-correlation-id") || crypto.randomUUID();

    const spanContext = trace.setSpan(parentContext, serverSpan);
    const startedAt = process.hrtime.bigint();

    if (ctx.set) {
      ctx.set.headers = ctx.set.headers || {};
      ctx.set.headers["x-correlation-id"] = correlationId;
    }

    return context.with(spanContext, async () => {
      try {
        const result = await handler(ctx, { correlationId, route, method });
        const statusCode = getStatusCode(ctx, result);
        const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

        httpRequestsTotal.labels(SERVICE_NAME, method, route, String(statusCode)).inc();
        httpRequestDurationSeconds.labels(SERVICE_NAME, method, route).observe(durationSeconds);

        serverSpan.setAttribute("http.status_code", statusCode);
        if (statusCode >= 500) {
          serverSpan.setStatus({ code: SpanStatusCode.ERROR, message: "Server error" });
        }
        serverSpan.end();

        logInfo("http.request.completed", {
          correlation_id: correlationId,
          method,
          route,
          status_code: statusCode,
          duration_ms: Math.round(durationSeconds * 1000),
        });

        return result;
      } catch (error) {
        const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        const statusCode = getStatusCode(ctx, null) || 500;

        httpRequestsTotal.labels(SERVICE_NAME, method, route, String(statusCode)).inc();
        httpRequestDurationSeconds.labels(SERVICE_NAME, method, route).observe(durationSeconds);

        serverSpan.recordException(error instanceof Error ? error : new Error(String(error)));
        serverSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unhandled error",
        });
        serverSpan.end();

        logError("http.request.failed", {
          correlation_id: correlationId,
          method,
          route,
          status_code: statusCode,
          duration_ms: Math.round(durationSeconds * 1000),
          error: error instanceof Error ? error.message : String(error),
        });

        throw error;
      }
    });
  };
}

export async function withMessageTrace(messageName, messageHeaders, handler) {
  const parentContext = propagation.extract(ROOT_CONTEXT, messageHeaders || {});
  const span = tracer.startSpan(
    `MQ consume ${messageName}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        "messaging.system": "rabbitmq",
        "messaging.operation": "process",
        "messaging.destination.name": "suilens.events",
        "messaging.message.type": messageName,
      },
    },
    parentContext,
  );

  return context.with(trace.setSpan(parentContext, span), async () => {
    try {
      const result = await handler();
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "Failed to process message",
      });
      span.end();
      throw error;
    }
  });
}

export async function metricsResponse() {
  return new Response(await register.metrics(), {
    headers: {
      "content-type": register.contentType,
    },
  });
}
