import { test, expect } from "@playwright/test";
import { MOCK_COUPON_RESPONSES } from "./mocks/handlers.js";

test.describe("Staging Checkout Flow — DOMRay Automated Blueprints", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("Happy Path: applies valid discount coupon (SAVE10) and recalculates total", async ({
    page,
  }) => {
    // 1. Enter coupon code using accessible locator
    const couponInput = page.getByRole("textbox", { name: "Promo / Coupon Code" });
    const applyButton = page.getByRole("button", { name: "Apply" });

    await couponInput.click();
    await couponInput.fill("SAVE10");

    // 2. Correlated network transaction expectation
    const [couponResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/cart/coupon") && res.status() === 200
      ),
      applyButton.click(),
    ]);

    expect(couponResponse.ok()).toBe(true);

    // 3. UI assertions
    await expect(page.locator("#coupon-success-banner")).toBeVisible();
    await expect(page.locator("#coupon-success-banner")).toContainText(
      "10% discount applied"
    );
    await expect(page.getByText("$61.20")).toBeVisible();

    // 4. Submit checkout flow
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("Order placed successfully");
      void dialog.accept();
    });

    await page.getByRole("button", { name: /Complete Checkout/i }).click();
  });

  test("Error Flow: intercepts expired coupon (EXPIRED20) with 422 mock", async ({
    page,
  }) => {
    // Intercept network call with DOMRay captured MSW mock payload
    await page.route("**/api/cart/coupon", async (route) => {
      const request = route.request();
      const body = JSON.parse(request.postData() || "{}");

      if (body.code === "EXPIRED20") {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify(MOCK_COUPON_RESPONSES.EXPIRED20_ERROR),
        });
      } else {
        await route.continue();
      }
    });

    const couponInput = page.getByRole("textbox", { name: "Promo / Coupon Code" });
    const applyButton = page.getByRole("button", { name: "Apply" });

    await couponInput.fill("EXPIRED20");

    // Verify 422 error network response is triggered
    const [couponResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/cart/coupon") && res.status() === 422
      ),
      applyButton.click(),
    ]);

    expect(couponResponse.status()).toBe(422);
    const errBody = await couponResponse.json();
    expect(errBody.code).toBe("COUPON_EXPIRED");
    expect(errBody.error).toContain("expired");
  });

  test("Resilience: handles non-existent coupon (INVALID99) with 404 mock", async ({
    page,
  }) => {
    await page.route("**/api/cart/coupon", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify(MOCK_COUPON_RESPONSES.NOT_FOUND_ERROR),
      });
    });

    const couponInput = page.getByRole("textbox", { name: "Promo / Coupon Code" });
    const applyButton = page.getByRole("button", { name: "Apply" });

    await couponInput.fill("INVALID99");

    const [couponResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/cart/coupon") && res.status() === 404
      ),
      applyButton.click(),
    ]);

    expect(couponResponse.status()).toBe(404);
  });
});
