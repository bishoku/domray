import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "mock-coupon-api",
      configureServer(server) {
        server.middlewares.use("/api/cart/coupon", (req, res) => {
          if (req.method === "POST") {
            let body = "";
            req.on("data", (chunk: Buffer) => {
              body += chunk.toString();
            });

            req.on("end", () => {
              // Add a small 120ms network latency to simulate real network round-trip
              setTimeout(() => {
                res.setHeader("Content-Type", "application/json");

                try {
                  const { code } = JSON.parse(body || "{}");
                  const normalizedCode = String(code || "").trim().toUpperCase();

                  if (normalizedCode === "SAVE10") {
                    res.statusCode = 200;
                    res.end(
                      JSON.stringify({
                        success: true,
                        code: "SAVE10",
                        discount: 10,
                        discountAmount: 6.8,
                        newTotal: 61.2,
                        message: "10% Early Adopter Discount applied!",
                      }),
                    );
                  } else if (normalizedCode === "EXPIRED20") {
                    // This triggers the real-world case study scenario!
                    res.statusCode = 422;
                    res.end(
                      JSON.stringify({
                        error: "Coupon expired on 2026-09-01",
                        code: "COUPON_EXPIRED",
                        status: 422,
                      }),
                    );
                  } else {
                    res.statusCode = 404;
                    res.end(
                      JSON.stringify({
                        error: `Coupon "${normalizedCode}" was not found.`,
                        code: "COUPON_NOT_FOUND",
                        status: 404,
                      }),
                    );
                  }
                } catch {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: "Invalid JSON payload" }));
                }
              }, 120);
            });
          } else {
            res.statusCode = 405;
            res.end("Method Not Allowed");
          }
        });
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: false,
  },
});
