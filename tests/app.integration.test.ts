import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createServer } from "../src/server/app";

const ADMIN_KEY = "bidladder-test-admin-key-000000000001";
const STRIPE_WEBHOOK_SECRET = "whsec_bidladder_integration_tests";

interface MockCheckoutSession {
  amount_total: number;
  client_reference_id: string;
  currency: string;
  expires_at: number;
  id: string;
  metadata: Record<string, string>;
  payment_intent: string | null;
  payment_status: "paid" | "unpaid";
  status: "complete" | "expired" | "open";
  url: string;
}

function installStripeMock() {
  const sessions = new Map<string, MockCheckoutSession>();
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input));
    const method = init?.method ?? request?.method ?? "GET";

    if (url.origin !== "https://api.stripe.com") {
      throw new Error(`Unexpected outbound request: ${method} ${url.toString()}`);
    }

    if (method === "POST" && url.pathname === "/v1/checkout/sessions") {
      const rawBody = init?.body ?? (request ? await request.text() : "");
      const parameters = new URLSearchParams(String(rawBody));
      const id = `cs_test_bidladder_${crypto.randomUUID().replaceAll("-", "")}`;
      const bidId = parameters.get("client_reference_id") ?? "";
      const attemptId = parameters.get("metadata[payment_attempt_id]") ?? "";
      const session: MockCheckoutSession = {
        amount_total: Number(parameters.get("line_items[0][price_data][unit_amount]")),
        client_reference_id: bidId,
        currency: parameters.get("line_items[0][price_data][currency]") ?? "usd",
        expires_at: Math.floor(Date.now() / 1000) + 1800,
        id,
        metadata: { bid_id: bidId, payment_attempt_id: attemptId },
        payment_intent: null,
        payment_status: "unpaid",
        status: "open",
        url: `https://checkout.stripe.com/c/pay/${id}`,
      };
      sessions.set(id, session);
      return Response.json(session);
    }

    const sessionId = url.pathname.match(/^\/v1\/checkout\/sessions\/(.+)$/)?.[1];
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (method === "GET" && session) {
      return Response.json(session);
    }

    const paymentIntentId = url.pathname.match(/^\/v1\/payment_intents\/(.+)$/)?.[1];
    const paymentIntentSession = paymentIntentId
      ? [...sessions.values()].find((item) => item.payment_intent === paymentIntentId)
      : undefined;
    if (method === "GET" && paymentIntentId && paymentIntentSession) {
      return Response.json({
        amount: paymentIntentSession.amount_total,
        currency: paymentIntentSession.currency,
        id: paymentIntentId,
        latest_charge: `ch_${paymentIntentId}`,
        metadata: paymentIntentSession.metadata,
        object: "payment_intent",
      });
    }

    return Response.json(
      { error: { message: `Unmocked Stripe endpoint: ${method} ${url.pathname}` } },
      { status: 404 },
    );
  });

  return { fetchSpy, sessions };
}

async function stripeSignature(payload: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(STRIPE_WEBHOOK_SECRET),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const signature = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `t=${timestamp},v1=${signature}`;
}

function stripeEvent(id: string, type: string, object: Record<string, unknown>) {
  return JSON.stringify({
    api_version: "2026-07-29.dahlia",
    created: Math.floor(Date.now() / 1000),
    data: { object },
    id,
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    request: null,
    type,
  });
}

async function postStripeWebhook(
  server: ReturnType<typeof createServer>,
  payload: string,
  signature?: string,
) {
  const resolvedSignature = signature ?? (await stripeSignature(payload));
  return server.request(
    "https://example.test/api/v1/webhooks/stripe",
    {
      body: payload,
      headers: { "Content-Type": "application/json", "Stripe-Signature": resolvedSignature },
      method: "POST",
    },
    env,
  );
}

function createTestServer() {
  return createServer(async () => new Response("SSR fallback", { status: 200 }));
}

function submitBid(
  server: ReturnType<typeof createServer>,
  idempotencyKey: string,
  websiteHost: string,
) {
  return server.request(
    "http://example.test/api/v1/leaderboards/main/bids",
    {
      body: JSON.stringify({
        amount: 125,
        contactEmail: "team@example.com",
        logoUrl: "",
        name: "Example Tools",
        tagline: "Useful tools for independent builders.",
        websiteUrl: `https://${websiteHost}/tools`,
      }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      method: "POST",
    },
    env,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Worker request ownership", () => {
  it("keeps health, API misses, and SSR fallback distinct", async () => {
    const server = createTestServer();

    const health = await server.request("http://example.test/health", undefined, env);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ service: "bidladder", status: "ok" });

    const sitemap = await server.request("https://example.test/sitemap.xml", undefined, env);
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers.get("content-type")).toContain("application/xml");
    await expect(sitemap.text()).resolves.toBe(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.test/</loc></url><url><loc>https://example.test/rules</loc></url><url><loc>https://example.test/deploy</loc></url></urlset>',
    );

    const apiMiss = await server.request("http://example.test/api/unknown", undefined, env);
    expect(apiMiss.status).toBe(404);
    expect(apiMiss.headers.get("content-type")).toContain("application/json");

    const page = await server.request(
      "http://example.test/",
      undefined,
      env,
      createExecutionContext(),
    );
    expect(await page.text()).toBe("SSR fallback");
  });
});

describe("Bid lifecycle", () => {
  it("requires payment, handles webhook replay and ordering, then pauses on refund", async () => {
    const server = createTestServer();
    const stripe = installStripeMock();
    const submission = await submitBid(server, "integration-submit-0001", "lifecycle.example");
    expect(submission.status).toBe(202);
    const submissionBody = (await submission.json()) as { data: { bidId: string } };
    const bidId = submissionBody.data.bidId;

    const denied = await server.request(
      "http://example.test/api/v1/admin/bids?status=pending",
      undefined,
      env,
    );
    expect(denied.status).toBe(401);

    const invalidKey = await server.request(
      "http://example.test/api/v1/admin/bids?status=pending",
      { headers: { Authorization: "Bearer this-key-does-not-match-the-configured-hash" } },
      env,
    );
    expect(invalidKey.status).toBe(401);

    const pending = await server.request(
      "http://example.test/api/v1/admin/bids?status=pending",
      { headers: { Authorization: `Bearer ${ADMIN_KEY}` } },
      env,
    );
    expect(pending.status).toBe(200);
    const pendingBody = (await pending.json()) as { data: Array<{ id: string; name: string }> };
    expect(pendingBody.data).toEqual([
      expect.objectContaining({ id: submissionBody.data.bidId, name: "Example Tools" }),
    ]);

    const prematureApproval = await server.request(
      `http://example.test/api/v1/admin/bids/${bidId}/decision`,
      {
        body: JSON.stringify({ decision: "approved" }),
        headers: {
          Authorization: `Bearer ${ADMIN_KEY}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
      env,
    );
    expect(prematureApproval.status).toBe(409);

    const checkout = await server.request(
      `https://example.test/api/v1/bids/${bidId}/checkout`,
      { method: "POST" },
      env,
    );
    expect(checkout.status).toBe(200);
    await expect(checkout.json()).resolves.toMatchObject({
      data: { bidId, paymentStatus: "checkout_open" },
    });
    const [session] = [...stripe.sessions.values()];
    expect(session).toBeDefined();
    if (!session) {
      throw new Error("Stripe checkout mock did not record a session.");
    }
    session.payment_status = "paid";
    session.status = "complete";
    session.payment_intent = "pi_test_bidladder_1";

    const completedEvent = stripeEvent(
      "evt_checkout_completed_0001",
      "checkout.session.completed",
      {
        id: session.id,
        object: "checkout.session",
      },
    );
    const webhook = await postStripeWebhook(server, completedEvent);
    expect(webhook.status).toBe(200);
    await expect(webhook.json()).resolves.toMatchObject({
      data: { replayed: false, status: "processed" },
    });

    const replay = await postStripeWebhook(server, completedEvent);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      data: { replayed: true, status: "processed" },
    });

    const lateExpiry = stripeEvent("evt_checkout_expired_late_0001", "checkout.session.expired", {
      id: session.id,
      object: "checkout.session",
    });
    expect((await postStripeWebhook(server, lateExpiry)).status).toBe(200);

    const payment = await server.request(
      `http://example.test/api/v1/bids/${bidId}/payment`,
      undefined,
      env,
    );
    await expect(payment.json()).resolves.toMatchObject({ data: { paymentStatus: "paid" } });

    const approval = await server.request(
      `http://example.test/api/v1/admin/bids/${bidId}/decision`,
      {
        body: JSON.stringify({ decision: "approved" }),
        headers: {
          Authorization: `Bearer ${ADMIN_KEY}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
      env,
    );
    expect(approval.status).toBe(200);

    const leaderboard = await server.request(
      "http://example.test/api/v1/leaderboards/main",
      undefined,
      env,
    );
    const leaderboardBody = (await leaderboard.json()) as {
      data: {
        generatedAt: number;
        ladder: {
          refundInitiationBusinessDays: number;
          reviewWindowBusinessDays: number;
        };
        placements: Array<{
          amountCents: number;
          clickCount: number;
          id: string;
          name: string;
          updatedAt: number;
        }>;
      };
    };
    expect(leaderboardBody.data.ladder).toMatchObject({
      refundInitiationBusinessDays: 5,
      reviewWindowBusinessDays: 3,
    });
    expect(leaderboardBody.data.placements).toEqual([
      expect.objectContaining({ amountCents: 12500, clickCount: 0, name: "Example Tools" }),
    ]);
    const [publishedPlacement] = leaderboardBody.data.placements;
    if (!publishedPlacement) {
      throw new Error("Approved placement was not returned by the leaderboard.");
    }
    expect(publishedPlacement.updatedAt).toBeLessThanOrEqual(leaderboardBody.data.generatedAt);

    const click = await server.request(
      `http://example.test/go/${publishedPlacement.id}`,
      { headers: { "User-Agent": "Mozilla/5.0 BidLadder integration test" } },
      env,
    );
    expect(click.status).toBe(302);
    expect(click.headers.get("location")).toBe("https://lifecycle.example/tools");
    expect(click.headers.get("cache-control")).toBe("private, no-store");

    const botClick = await server.request(
      `http://example.test/go/${publishedPlacement.id}`,
      { headers: { "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" } },
      env,
    );
    expect(botClick.status).toBe(302);

    const afterClicks = await server.request(
      "http://example.test/api/v1/leaderboards/main",
      undefined,
      env,
    );
    await expect(afterClicks.json()).resolves.toMatchObject({
      data: { placements: [expect.objectContaining({ clickCount: 1 })] },
    });

    const refund = stripeEvent("evt_charge_refunded_0001", "charge.refunded", {
      amount: 12500,
      amount_refunded: 12500,
      currency: "usd",
      id: "ch_test_bidladder_1",
      object: "charge",
      payment_intent: session.payment_intent,
    });
    expect((await postStripeWebhook(server, refund)).status).toBe(200);

    const afterRefund = await server.request(
      "http://example.test/api/v1/leaderboards/main",
      undefined,
      env,
    );
    const afterRefundBody = (await afterRefund.json()) as {
      data: { placements: Array<unknown> };
    };
    expect(afterRefundBody.data.placements).toEqual([]);

    const refundedPayment = await server.request(
      `http://example.test/api/v1/bids/${bidId}/payment`,
      undefined,
      env,
    );
    await expect(refundedPayment.json()).resolves.toMatchObject({
      data: { paymentStatus: "refunded" },
    });
    expect(stripe.fetchSpy).toHaveBeenCalled();
  });

  it("does not lose a refund delivered before the checkout completion event", async () => {
    const server = createTestServer();
    const stripe = installStripeMock();
    const submission = await submitBid(
      server,
      "integration-refund-order-0001",
      "refund-order.example",
    );
    const submissionBody = (await submission.json()) as { data: { bidId: string } };
    const bidId = submissionBody.data.bidId;

    expect(
      (
        await server.request(
          `https://example.test/api/v1/bids/${bidId}/checkout`,
          { method: "POST" },
          env,
        )
      ).status,
    ).toBe(200);
    const [session] = [...stripe.sessions.values()];
    if (!session) {
      throw new Error("Stripe checkout mock did not record a session.");
    }
    session.payment_intent = "pi_test_refund_order_1";

    const refund = stripeEvent("evt_refund_before_checkout_0001", "charge.refunded", {
      amount: 12500,
      amount_refunded: 12500,
      currency: "usd",
      id: "ch_test_refund_order_1",
      object: "charge",
      payment_intent: session.payment_intent,
    });
    expect((await postStripeWebhook(server, refund)).status).toBe(200);

    session.payment_status = "paid";
    session.status = "complete";
    const completion = stripeEvent("evt_checkout_after_refund_0001", "checkout.session.completed", {
      id: session.id,
      object: "checkout.session",
    });
    expect((await postStripeWebhook(server, completion)).status).toBe(200);

    const payment = await server.request(
      `http://example.test/api/v1/bids/${bidId}/payment`,
      undefined,
      env,
    );
    await expect(payment.json()).resolves.toMatchObject({
      data: { paymentStatus: "refunded" },
    });
  });

  it("rejects invalid webhook signatures before recording an event", async () => {
    const server = createTestServer();
    const payload = stripeEvent("evt_invalid_signature_0001", "checkout.session.completed", {
      id: "cs_test_never_loaded",
      object: "checkout.session",
    });
    const response = await postStripeWebhook(server, payload, "t=1,v1=invalid");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "bad_request" } });
  });

  it("replays one idempotency key without creating another bid", async () => {
    const server = createTestServer();
    const first = await submitBid(server, "integration-idempotent-0001", "idempotent.example");
    const replay = await submitBid(server, "integration-idempotent-0001", "idempotent.example");

    expect(first.status).toBe(202);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ data: { replayed: true } });
  });

  it("rejects a second pending bid for the same sponsor", async () => {
    const server = createTestServer();
    const first = await submitBid(server, "integration-pending-0001", "pending.example");
    const second = await submitBid(server, "integration-pending-0002", "pending.example");

    expect(first.status).toBe(202);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ error: { code: "conflict" } });
  });

  it("uses stable platform identities instead of collapsing every shared host", async () => {
    const server = createTestServer();
    const firstApp = await server.request(
      "http://example.test/api/v1/leaderboards/main/bids",
      {
        body: JSON.stringify({
          amount: 25,
          contactEmail: "apps@example.com",
          logoUrl: "",
          name: "First App",
          tagline: "The first shared-host application.",
          websiteUrl: "https://apps.apple.com/us/app/first/id123456789?uo=4",
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "integration-app-identity-0001",
        },
        method: "POST",
      },
      env,
    );
    const sameApp = await server.request(
      "http://example.test/api/v1/leaderboards/main/bids",
      {
        body: JSON.stringify({
          amount: 25,
          contactEmail: "apps@example.com",
          logoUrl: "",
          name: "First App Again",
          tagline: "The same application in another storefront.",
          websiteUrl: "https://apps.apple.com/gb/app/renamed/id123456789?mt=8",
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "integration-app-identity-0002",
        },
        method: "POST",
      },
      env,
    );
    const differentApp = await server.request(
      "http://example.test/api/v1/leaderboards/main/bids",
      {
        body: JSON.stringify({
          amount: 25,
          contactEmail: "apps@example.com",
          logoUrl: "",
          name: "Second App",
          tagline: "A different application on the shared host.",
          websiteUrl: "https://apps.apple.com/us/app/second/id987654321?uo=4",
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "integration-app-identity-0003",
        },
        method: "POST",
      },
      env,
    );

    expect(firstApp.status).toBe(202);
    expect(sameApp.status).toBe(409);
    expect(differentApp.status).toBe(202);
  });

  it("keeps public metadata stable until approval and adds approved contributions", async () => {
    const server = createTestServer();
    const stripe = installStripeMock();

    async function payAndApprove(response: Response, sequence: string) {
      const body = (await response.json()) as { data: { bidId: string } };
      const checkout = await server.request(
        `https://example.test/api/v1/bids/${body.data.bidId}/checkout`,
        { method: "POST" },
        env,
      );
      expect(checkout.status).toBe(200);
      const session = [...stripe.sessions.values()].at(-1);
      if (!session) {
        throw new Error("Stripe checkout mock did not record a session.");
      }
      session.payment_status = "paid";
      session.status = "complete";
      session.payment_intent = `pi_snapshot_${sequence}`;
      const paymentEvent = stripeEvent(`evt_snapshot_${sequence}`, "checkout.session.completed", {
        id: session.id,
        object: "checkout.session",
      });
      expect((await postStripeWebhook(server, paymentEvent)).status).toBe(200);
      const approval = await server.request(
        `http://example.test/api/v1/admin/bids/${body.data.bidId}/decision`,
        {
          body: JSON.stringify({ decision: "approved" }),
          headers: {
            Authorization: `Bearer ${ADMIN_KEY}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        },
        env,
      );
      expect(approval.status).toBe(200);
    }

    const first = await server.request(
      "http://example.test/api/v1/leaderboards/main/bids",
      {
        body: JSON.stringify({
          amount: 125,
          contactEmail: "owner@stable.example",
          logoUrl: "",
          name: "Stable Product",
          tagline: "The approved public description.",
          websiteUrl: "https://stable.example/product?utm_source=first",
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "integration-snapshot-0001",
        },
        method: "POST",
      },
      env,
    );
    await payAndApprove(first, "0001");

    const firstLeaderboard = await server.request(
      "http://example.test/api/v1/leaderboards/main",
      undefined,
      env,
    );
    const firstLeaderboardBody = (await firstLeaderboard.json()) as {
      data: { placements: Array<{ id: string }> };
    };
    const firstPlacement = firstLeaderboardBody.data.placements[0];
    if (!firstPlacement) {
      throw new Error("Initial stable placement was not returned by the leaderboard.");
    }
    expect(
      (
        await server.request(
          `http://example.test/go/${firstPlacement.id}`,
          { headers: { "User-Agent": "Mozilla/5.0 BidLadder integration test" } },
          env,
        )
      ).status,
    ).toBe(302);

    const second = await server.request(
      "http://example.test/api/v1/leaderboards/main/bids",
      {
        body: JSON.stringify({
          amount: 50,
          contactEmail: "new-owner@stable.example",
          logoUrl: "",
          name: "Updated Product",
          tagline: "The replacement description after approval.",
          websiteUrl: "https://stable.example/product?utm_source=second",
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "integration-snapshot-0002",
        },
        method: "POST",
      },
      env,
    );
    expect(second.status).toBe(202);

    const beforeApproval = await server.request(
      "http://example.test/api/v1/leaderboards/main",
      undefined,
      env,
    );
    await expect(beforeApproval.json()).resolves.toMatchObject({
      data: {
        placements: [expect.objectContaining({ amountCents: 12500, name: "Stable Product" })],
      },
    });

    await payAndApprove(second, "0002");
    const afterApproval = await server.request(
      "http://example.test/api/v1/leaderboards/main",
      undefined,
      env,
    );
    await expect(afterApproval.json()).resolves.toMatchObject({
      data: {
        placements: [
          expect.objectContaining({
            amountCents: 17500,
            clickCount: 1,
            name: "Updated Product",
            websiteUrl: "https://stable.example/product",
          }),
        ],
      },
    });
  });

  it("rejects bids below the configured minimum", async () => {
    const server = createTestServer();
    const response = await server.request(
      "http://example.test/api/v1/leaderboards/main/bids",
      {
        body: JSON.stringify({
          amount: 1,
          contactEmail: "team@small.example",
          logoUrl: "",
          name: "Small Sponsor",
          tagline: "A bid below the minimum.",
          websiteUrl: "https://small.example",
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "integration-minimum-0001",
        },
        method: "POST",
      },
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "bad_request" } });
  });

  it("rejects oversized JSON before validation", async () => {
    const server = createTestServer();
    const response = await server.request(
      "http://example.test/api/v1/leaderboards/main/bids",
      {
        body: JSON.stringify({ padding: "x".repeat(17 * 1024) }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "integration-oversized-0001",
        },
        method: "POST",
      },
      env,
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "request_too_large" },
    });
  });

  it("rate limits repeated writes by sponsor identity", async () => {
    const server = createTestServer();
    const responses: Response[] = [];
    for (let index = 0; index < 13; index += 1) {
      responses.push(await submitBid(server, "integration-rate-limit-0001", "rate-limit.example"));
    }

    expect(responses.slice(0, 12).every((response) => response.status < 429)).toBe(true);
    expect(responses[12]?.status).toBe(429);
    expect(responses[12]?.headers.get("retry-after")).toBe("60");
    await expect(responses[12]?.json()).resolves.toMatchObject({
      error: { code: "rate_limited" },
    });
  });
});
