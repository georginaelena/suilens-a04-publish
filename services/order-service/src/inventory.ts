import { tracedFetch } from "./observability.js";

const INVENTORY_SERVICE_URL =
  process.env.INVENTORY_SERVICE_URL || "http://localhost:3004";

interface InventoryReservationPayload {
  orderId: string;
  lensId: string;
  branchCode: string;
  quantity: number;
}

interface InventoryErrorResponse {
  error?: string;
}

export async function reserveInventory(
  payload: InventoryReservationPayload,
  headers: Record<string, string> = {},
): Promise<
  { ok: true } | { ok: false; status: 404 | 409 | 500; error: string }
> {
  const response = await tracedFetch(
    `${INVENTORY_SERVICE_URL}/api/inventory/reserve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
    },
    {
      "peer.service": "inventory-service",
      "http.route": "/api/inventory/reserve",
    },
  ).catch(() => null);

  if (!response) {
    return {
      ok: false,
      status: 500,
      error: "Failed to reach inventory service",
    };
  }

  if (response.ok) {
    return { ok: true };
  }

  const errorBody = (await response.json().catch(() => null)) as
    | InventoryErrorResponse
    | null;

  return {
    ok: false,
    status: response.status === 404 ? 404 : response.status === 409 ? 409 : 500,
    error: errorBody?.error || "Failed to reserve inventory",
  };
}

export async function releaseInventory(orderId: string, headers: Record<string, string> = {}) {
  await tracedFetch(
    `${INVENTORY_SERVICE_URL}/api/inventory/release`,
    {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ orderId }),
    },
    {
      "peer.service": "inventory-service",
      "http.route": "/api/inventory/release",
    },
  ).catch(() => null);
}
