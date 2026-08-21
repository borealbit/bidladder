import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createServer } from "../src/server/app";

const ADMIN_KEY = "bidladder-test-admin-key-000000000001";

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

describe("Worker request ownership", () => {
  it("keeps health, API misses, and SSR fallback distinct", async () => {
    const server = createTestServer();

    const health = await server.request("http://example.test/health", undefined, env);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ service: "bidladder", status: "ok" });

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
  it("submits, protects moderation, approves, and publishes a bid", async () => {
    const server = createTestServer();
    const submission = await submitBid(server, "integration-submit-0001", "lifecycle.example");
    expect(submission.status).toBe(202);
    const submissionBody = (await submission.json()) as { data: { bidId: string } };

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

    const approval = await server.request(
      `http://example.test/api/v1/admin/bids/${submissionBody.data.bidId}/decision`,
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
      data: { placements: Array<{ amountCents: number; name: string }> };
    };
    expect(leaderboardBody.data.placements).toEqual([
      expect.objectContaining({ amountCents: 12500, name: "Example Tools" }),
    ]);
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
});
