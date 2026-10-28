// Product Studio's client calls: its own endpoints and the shared retry of a generation; the
// product photo goes through the shared `uploadImageFile`. Client-safe.
import {
  type CreateShootInput,
  shootListSchema,
  shootSchema,
} from "#/features/productStudio/contracts";
import { generationReceiptSchema } from "#/shared/contracts";
import { callApi } from "#/shared/requests";

const json = { Accept: "application/json" };

/**
 * `POST /api/product-shots`: admits one shot per preset of `body` under `requestKey`; the same key
 * again (a lost answer, a second click) returns the shoot it admitted, never a second one.
 */
export function postShoot(body: CreateShootInput, requestKey: string) {
  return callApi(shootSchema, "/api/product-shots", {
    body: JSON.stringify({ ...body, request_key: requestKey }),
    headers: { ...json, "Content-Type": "application/json" },
    method: "POST",
  });
}

/** `GET /api/product-shots/:id`. */
export function fetchShoot(id: string, signal?: AbortSignal) {
  return callApi(shootSchema, `/api/product-shots/${id}`, { headers: json, method: "GET", signal });
}

/** `GET /api/product-shots`: the workspace's latest shoots. */
export function fetchShoots(signal?: AbortSignal) {
  return callApi(shootListSchema, "/api/product-shots", { headers: json, method: "GET", signal });
}

/**
 * `POST /api/generations/:id/retry`, the shared retry: a failed or cancelled shot's child with a
 * new seed; refused (409) for an `unknown` one, which Comfy may still be rendering.
 */
export function retryShot(id: string) {
  return callApi(generationReceiptSchema, `/api/generations/${id}/retry`, {
    headers: json,
    method: "POST",
  });
}
