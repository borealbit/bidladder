import { Hono } from "hono";

import { requireAdmin } from "../../http/admin-auth";
import { readBoundedText, STRIPE_WEBHOOK_LIMIT_BYTES } from "../../http/body";
import { HttpProblem } from "../../http/problem";
import { enforceRateLimit, rateLimitKey, requestNetworkIdentity } from "../../http/rate-limit";
import { createDatabase } from "../../platform/d1/client";
import { createOrReuseCheckout, getPaymentSummary } from "./checkout";
import { createStripeClient, verifyStripeEvent } from "./stripe-client";
import { processStripeEvent, reconcilePayment } from "./webhook";

type PaymentApiEnvironment = {
  Bindings: Env;
};

async function limitPublicWrite(request: Request, environment: Env, actor: string) {
  const networkIdentity = requestNetworkIdentity(request);
  if (networkIdentity) {
    await enforceRateLimit(
      environment.PUBLIC_WRITE_RATE_LIMITER,
      await rateLimitKey(`network:${networkIdentity}`),
    );
  }
  await enforceRateLimit(
    environment.PUBLIC_WRITE_RATE_LIMITER,
    await rateLimitKey(`actor:${actor}`),
  );
}

async function limitAdmin(request: Request, environment: Env) {
  const identity =
    requestNetworkIdentity(request) ?? request.headers.get("authorization") ?? "none";
  await enforceRateLimit(environment.ADMIN_RATE_LIMITER, await rateLimitKey(`admin:${identity}`));
}

export function createPaymentsApi() {
  const api = new Hono<PaymentApiEnvironment>();

  api.get("/bids/:bidId/payment", async (context) => {
    const database = createDatabase(context.env.DB);
    return context.json({ data: await getPaymentSummary(database, context.req.param("bidId")) });
  });

  api.post("/bids/:bidId/checkout", async (context) => {
    const bidId = context.req.param("bidId");
    await limitPublicWrite(context.req.raw, context.env, `checkout:${bidId}`);
    const database = createDatabase(context.env.DB);
    const stripe = createStripeClient(context.env);
    const result = await createOrReuseCheckout(
      database,
      stripe,
      bidId,
      context.req.url,
      context.env.STRIPE_INTEGRATION_IDENTIFIER,
    );
    return context.json({ data: result });
  });

  api.post("/webhooks/stripe", async (context) => {
    const rawBody = await readBoundedText(context.req.raw, STRIPE_WEBHOOK_LIMIT_BYTES);
    const stripe = createStripeClient(context.env);
    const event = await verifyStripeEvent(
      stripe,
      rawBody,
      context.req.header("Stripe-Signature") ?? null,
      context.env.STRIPE_WEBHOOK_SECRET,
    );
    const database = createDatabase(context.env.DB);
    const result = await processStripeEvent(database, stripe, event);
    return context.json({ data: result });
  });

  api.use("/admin/*", async (context, next) => {
    await limitAdmin(context.req.raw, context.env);
    await requireAdmin(context.req.raw, context.env.ADMIN_API_KEY_HASH);
    await next();
  });

  api.post("/admin/payments/:bidId/reconcile", async (context) => {
    const database = createDatabase(context.env.DB);
    const stripe = createStripeClient(context.env);
    try {
      const result = await reconcilePayment(database, stripe, context.req.param("bidId"));
      return context.json({ data: result });
    } catch (error) {
      if (error instanceof HttpProblem) {
        throw error;
      }
      console.error(
        JSON.stringify({
          cause: error instanceof Error ? error.name : "UnknownError",
          code: "stripe_reconciliation_failed",
        }),
      );
      throw new HttpProblem(503, "service_unavailable", "Stripe reconciliation failed.");
    }
  });

  return api;
}
