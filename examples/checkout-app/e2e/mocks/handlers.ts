/**
 * handlers.ts — MSW v2 Mock Handlers synthesized by DOMRay
 *
 * Generated automatically from Chrome DevTools Protocol network telemetry:
 *   - POST /api/cart/coupon [SAVE10] -> HTTP 200 OK
 *   - POST /api/cart/coupon [EXPIRED20] -> HTTP 422 Unprocessable Entity
 */

import { http, HttpResponse } from "msw";

export const MOCK_COUPON_RESPONSES = {
  SAVE10_SUCCESS: {
    success: true,
    code: "SAVE10",
    discount: 10,
    discountAmount: 6.8,
    newTotal: 61.2,
    message: "10% Early Adopter Discount applied!",
  },
  EXPIRED20_ERROR: {
    error: "Coupon expired on 2026-09-01",
    code: "COUPON_EXPIRED",
    status: 422,
  },
  NOT_FOUND_ERROR: {
    error: 'Coupon "INVALID99" was not found.',
    code: "COUPON_NOT_FOUND",
    status: 404,
  },
};

export const handlers = [
  // Mock POST /api/cart/coupon
  http.post("*/api/cart/coupon", async ({ request }) => {
    let payload: { code?: string } = {};
    try {
      payload = (await request.json()) as { code?: string };
    } catch {
      // ignore
    }

    const code = (payload.code || "").toUpperCase().trim();

    if (code === "SAVE10") {
      return HttpResponse.json(MOCK_COUPON_RESPONSES.SAVE10_SUCCESS, {
        status: 200,
      });
    }

    if (code === "EXPIRED20") {
      return HttpResponse.json(MOCK_COUPON_RESPONSES.EXPIRED20_ERROR, {
        status: 422,
      });
    }

    return HttpResponse.json(
      {
        error: `Coupon "${code}" was not found.`,
        code: "COUPON_NOT_FOUND",
        status: 404,
      },
      { status: 404 }
    );
  }),
];
