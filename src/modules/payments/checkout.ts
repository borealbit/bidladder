import { and, desc, eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";

import { bids, paymentAttempts, paymentTransitions } from "../../../database/schema";
import { HttpProblem, isUniqueConstraintError } from "../../http/problem";
import type { Database } from "../../platform/d1/client";
import type { CheckoutResult, PaymentStatus, PaymentSummary } from "./contracts";
import type { StripeClient } from "./stripe-client";

const activeAttemptStatuses = ["creating", "open", "processing"] as const;

function paymentIntentId(value: string | { id: string } | null): string | null {
  if (typeof value === "string") {
    return value;
  }
  return value?.id ?? null;
}

function checkoutOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    if (!(url.protocol === "http:" && url.hostname === "127.0.0.1")) {
      throw new HttpProblem(400, "bad_request", "Checkout requires an HTTPS application origin.");
    }
  }
  return url.origin;
}

async function findActiveAttempt(database: Database, bidId: string) {
  return database.query.paymentAttempts.findFirst({
    orderBy: [desc(paymentAttempts.createdAt)],
    where: and(
      eq(paymentAttempts.bidId, bidId),
      inArray(paymentAttempts.status, [...activeAttemptStatuses]),
    ),
  });
}

async function createAttempt(
  database: Database,
  bidId: string,
  amountCents: number,
  currency: string,
  fromStatus: PaymentStatus,
) {
  const attemptId = crypto.randomUUID();
  const now = Date.now();

  try {
    await database.batch([
      database.insert(paymentAttempts).values({
        amountCents,
        bidId,
        createdAt: now,
        currency,
        id: attemptId,
        status: "creating",
        updatedAt: now,
      }),
      database
        .update(bids)
        .set({ paymentStatus: "checkout_pending", paymentUpdatedAt: now })
        .where(eq(bids.id, bidId)),
      database
        .insert(paymentTransitions)
        .values({
          bidId,
          createdAt: now,
          fromStatus,
          id: crypto.randomUUID(),
          paymentAttemptId: attemptId,
          sourceId: attemptId,
          sourceType: "checkout",
          toStatus: "checkout_pending",
        })
        .onConflictDoNothing(),
    ]);
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    const activeAttempt = await findActiveAttempt(database, bidId);
    if (activeAttempt) {
      return activeAttempt;
    }
    throw error;
  }

  const created = await database.query.paymentAttempts.findFirst({
    where: eq(paymentAttempts.id, attemptId),
  });
  if (!created) {
    throw new Error("Payment attempt insert returned no row.");
  }
  return created;
}

export async function createOrReuseCheckout(
  database: Database,
  stripe: StripeClient,
  bidId: string,
  requestUrl: string,
  integrationIdentifier: string,
): Promise<CheckoutResult> {
  const [record] = await database
    .select({
      amountCents: bids.amountCents,
      bidId: bids.id,
      contactEmail: bids.contactEmail,
      currency: bids.currency,
      name: bids.name,
      paymentStatus: bids.paymentStatus,
      status: bids.status,
      tagline: bids.tagline,
    })
    .from(bids)
    .where(eq(bids.id, bidId))
    .limit(1);

  if (!record) {
    throw new HttpProblem(404, "not_found", "Bid not found.");
  }
  if (record.status !== "pending") {
    throw new HttpProblem(409, "conflict", "Only a pending bid can enter checkout.");
  }
  if (
    record.paymentStatus === "paid" ||
    record.paymentStatus === "partially_refunded" ||
    record.paymentStatus === "refunded"
  ) {
    throw new HttpProblem(409, "conflict", "This bid already has a completed payment.");
  }
  if (!/^[a-z0-9_-]{8,64}$/i.test(integrationIdentifier)) {
    throw new HttpProblem(
      503,
      "service_unavailable",
      "Stripe integration identity is not configured.",
    );
  }

  let attempt = await findActiveAttempt(database, bidId);
  let currentPaymentStatus = record.paymentStatus;
  const now = Date.now();
  if (
    attempt?.status === "open" &&
    attempt.checkoutUrl &&
    (!attempt.expiresAt || attempt.expiresAt > now)
  ) {
    return { bidId, checkoutUrl: attempt.checkoutUrl, paymentStatus: "checkout_open" };
  }
  if (attempt?.status === "processing") {
    throw new HttpProblem(409, "conflict", "This payment is already processing.");
  }
  if (attempt?.status === "open" && attempt.expiresAt && attempt.expiresAt <= now) {
    await database.batch([
      database
        .update(paymentAttempts)
        .set({ status: "expired", updatedAt: now })
        .where(eq(paymentAttempts.id, attempt.id)),
      database
        .update(bids)
        .set({ paymentStatus: "expired", paymentUpdatedAt: now })
        .where(eq(bids.id, bidId)),
      database
        .insert(paymentTransitions)
        .values({
          bidId,
          createdAt: now,
          fromStatus: "checkout_open",
          id: crypto.randomUUID(),
          paymentAttemptId: attempt.id,
          sourceId: `${attempt.id}:local-expiry`,
          sourceType: "checkout",
          toStatus: "expired",
        })
        .onConflictDoNothing(),
    ]);
    attempt = undefined;
    currentPaymentStatus = "expired";
  }

  attempt ??= await createAttempt(
    database,
    bidId,
    record.amountCents,
    record.currency,
    currentPaymentStatus,
  );

  const origin = checkoutOrigin(requestUrl);
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        cancel_url: `${origin}/?checkout=cancelled&bid=${encodeURIComponent(bidId)}#place-bid`,
        client_reference_id: bidId,
        customer_email: record.contactEmail,
        integration_identifier: integrationIdentifier,
        line_items: [
          {
            price_data: {
              currency: record.currency.toLowerCase(),
              product_data: {
                description: record.tagline,
                name: `Sponsored placement — ${record.name}`,
              },
              unit_amount: record.amountCents,
            },
            quantity: 1,
          },
        ],
        metadata: { bid_id: bidId, payment_attempt_id: attempt.id },
        mode: "payment",
        payment_intent_data: {
          metadata: { bid_id: bidId, payment_attempt_id: attempt.id },
        },
        success_url: `${origin}/?checkout=success&bid=${encodeURIComponent(bidId)}`,
      },
      { idempotencyKey: `bidladder-checkout-${attempt.id}` },
    );
  } catch (error) {
    await database
      .update(paymentAttempts)
      .set({ lastErrorCode: "stripe_checkout_unavailable", updatedAt: Date.now() })
      .where(eq(paymentAttempts.id, attempt.id));
    console.error(
      JSON.stringify({
        bidId,
        cause: error instanceof Error ? error.name : "UnknownError",
        code: "stripe_checkout_unavailable",
      }),
    );
    throw new HttpProblem(
      503,
      "service_unavailable",
      "Stripe Checkout is temporarily unavailable.",
    );
  }

  const checkoutUrl = session.url;
  if (
    !checkoutUrl?.startsWith("https://") ||
    (session.amount_total !== null && session.amount_total !== record.amountCents) ||
    (session.currency !== null && session.currency.toUpperCase() !== record.currency)
  ) {
    await database
      .update(paymentAttempts)
      .set({ lastErrorCode: "stripe_checkout_mismatch", updatedAt: Date.now() })
      .where(eq(paymentAttempts.id, attempt.id));
    throw new HttpProblem(503, "service_unavailable", "Stripe Checkout returned invalid details.");
  }

  const updatedAt = Date.now();
  await database.batch([
    database
      .update(paymentAttempts)
      .set({
        checkoutUrl,
        expiresAt: session.expires_at * 1000,
        lastErrorCode: null,
        providerCheckoutSessionId: session.id,
        providerPaymentIntentId: paymentIntentId(session.payment_intent),
        status: "open",
        updatedAt,
      })
      .where(eq(paymentAttempts.id, attempt.id)),
    database
      .update(bids)
      .set({ paymentStatus: "checkout_open", paymentUpdatedAt: updatedAt })
      .where(eq(bids.id, bidId)),
    database
      .insert(paymentTransitions)
      .values({
        bidId,
        createdAt: updatedAt,
        fromStatus: "checkout_pending",
        id: crypto.randomUUID(),
        paymentAttemptId: attempt.id,
        sourceId: attempt.id,
        sourceType: "checkout",
        toStatus: "checkout_open",
      })
      .onConflictDoNothing(),
  ]);

  return { bidId, checkoutUrl, paymentStatus: "checkout_open" };
}

export async function getPaymentSummary(
  database: Database,
  bidId: string,
): Promise<PaymentSummary> {
  const record = await database.query.bids.findFirst({ where: eq(bids.id, bidId) });
  if (!record) {
    throw new HttpProblem(404, "not_found", "Bid not found.");
  }
  return {
    bidId: record.id,
    moderationStatus: record.status,
    paymentStatus: record.paymentStatus,
  };
}
