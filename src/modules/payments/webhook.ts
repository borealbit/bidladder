import { and, desc, eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";

import {
  bids,
  paymentAttempts,
  paymentTransitions,
  placements,
  stripeEvents,
} from "../../../database/schema";
import { HttpProblem, isUniqueConstraintError } from "../../http/problem";
import type { Database } from "../../platform/d1/client";
import type { PaymentStatus } from "./contracts";
import type { StripeClient } from "./stripe-client";

type AttemptStatus = (typeof paymentAttempts.$inferSelect)["status"];
type EventOutcome = "ignored" | "processed" | "quarantined";

const handledCheckoutEvents = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

function objectId(event: Stripe.Event): string | null {
  const object = event.data.object as { id?: unknown };
  return typeof object.id === "string" ? object.id : null;
}

function relatedObjectId(value: string | { id: string } | null): string | null {
  if (typeof value === "string") {
    return value;
  }
  return value?.id ?? null;
}

async function claimEvent(database: Database, event: Stripe.Event): Promise<boolean> {
  try {
    await database.insert(stripeEvents).values({
      eventType: event.type,
      id: event.id,
      livemode: event.livemode,
      objectId: objectId(event),
      status: "processing",
    });
    return true;
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }

  const existing = await database.query.stripeEvents.findFirst({
    where: eq(stripeEvents.id, event.id),
  });
  if (!existing) {
    throw new Error("Stripe event claim returned no row.");
  }
  if (existing.status === "failed") {
    const [reclaimed] = await database
      .update(stripeEvents)
      .set({ failureCode: null, status: "processing" })
      .where(and(eq(stripeEvents.id, event.id), eq(stripeEvents.status, "failed")))
      .returning({ id: stripeEvents.id });
    if (reclaimed) {
      return true;
    }
    throw new HttpProblem(503, "service_unavailable", "Stripe event is already processing.");
  }
  if (existing.status === "processing") {
    throw new HttpProblem(503, "service_unavailable", "Stripe event is already processing.");
  }
  return false;
}

async function finishEvent(
  database: Database,
  event: Stripe.Event,
  status: "ignored" | "quarantined",
  failureCode: string | null,
): Promise<EventOutcome> {
  await database
    .update(stripeEvents)
    .set({ failureCode, processedAt: Date.now(), status })
    .where(eq(stripeEvents.id, event.id));

  if (status === "quarantined") {
    console.error(
      JSON.stringify({
        code: "stripe_event_quarantined",
        eventId: event.id,
        eventType: event.type,
        reason: failureCode,
      }),
    );
  }
  return status;
}

function transitionRules(target: PaymentStatus): {
  attemptFrom: AttemptStatus[];
  bidFrom: PaymentStatus[];
} {
  switch (target) {
    case "processing":
      return {
        attemptFrom: ["creating", "open", "processing"],
        bidFrom: ["unpaid", "checkout_pending", "checkout_open", "processing"],
      };
    case "paid":
      return {
        attemptFrom: ["creating", "open", "processing", "paid"],
        bidFrom: ["unpaid", "checkout_pending", "checkout_open", "processing", "paid"],
      };
    case "failed":
    case "expired":
      return {
        attemptFrom: ["creating", "open", "processing"],
        bidFrom: ["unpaid", "checkout_pending", "checkout_open", "processing"],
      };
    default:
      return { attemptFrom: [], bidFrom: [] };
  }
}

async function applyCheckoutState(
  database: Database,
  event: Stripe.Event,
  attempt: typeof paymentAttempts.$inferSelect,
  target: "expired" | "failed" | "paid" | "processing",
  providerPaymentIntentId: string | null,
) {
  const now = Date.now();
  const rules = transitionRules(target);
  const paidAt = target === "paid" ? now : attempt.paidAt;
  const bid = await database.query.bids.findFirst({ where: eq(bids.id, attempt.bidId) });

  if (
    !rules.attemptFrom.includes(attempt.status) ||
    !bid ||
    !rules.bidFrom.includes(bid.paymentStatus)
  ) {
    await database.batch([
      database
        .update(paymentAttempts)
        .set({ providerPaymentIntentId, updatedAt: now })
        .where(eq(paymentAttempts.id, attempt.id)),
      database
        .update(stripeEvents)
        .set({
          failureCode: null,
          paymentAttemptId: attempt.id,
          processedAt: now,
          status: "processed",
        })
        .where(eq(stripeEvents.id, event.id)),
    ]);
    return;
  }

  await database.batch([
    database
      .update(paymentAttempts)
      .set({ providerPaymentIntentId, updatedAt: now })
      .where(eq(paymentAttempts.id, attempt.id)),
    database
      .update(paymentAttempts)
      .set({ paidAt, status: target, updatedAt: now })
      .where(
        and(eq(paymentAttempts.id, attempt.id), inArray(paymentAttempts.status, rules.attemptFrom)),
      ),
    database
      .update(bids)
      .set({
        paidAt: target === "paid" ? now : undefined,
        paymentStatus: target,
        paymentUpdatedAt: now,
      })
      .where(and(eq(bids.id, attempt.bidId), inArray(bids.paymentStatus, rules.bidFrom))),
    database
      .insert(paymentTransitions)
      .values({
        bidId: attempt.bidId,
        createdAt: now,
        fromStatus: attempt.status,
        id: crypto.randomUUID(),
        paymentAttemptId: attempt.id,
        sourceId: event.id,
        sourceType: "webhook",
        toStatus: target,
      })
      .onConflictDoNothing(),
    database
      .update(stripeEvents)
      .set({
        failureCode: null,
        paymentAttemptId: attempt.id,
        processedAt: now,
        status: "processed",
      })
      .where(eq(stripeEvents.id, event.id)),
  ]);
}

async function processCheckoutEvent(
  database: Database,
  stripe: StripeClient,
  event: Stripe.Event,
): Promise<EventOutcome> {
  const sessionId = objectId(event);
  if (!sessionId) {
    return finishEvent(database, event, "quarantined", "checkout_session_id_missing");
  }

  const attempt = await database.query.paymentAttempts.findFirst({
    where: eq(paymentAttempts.providerCheckoutSessionId, sessionId),
  });
  if (!attempt) {
    return finishEvent(database, event, "quarantined", "payment_attempt_not_found");
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (
    session.client_reference_id !== attempt.bidId ||
    session.metadata?.payment_attempt_id !== attempt.id ||
    session.amount_total !== attempt.amountCents ||
    session.currency?.toUpperCase() !== attempt.currency
  ) {
    return finishEvent(database, event, "quarantined", "checkout_session_mismatch");
  }

  let target: "expired" | "failed" | "paid" | "processing";
  switch (event.type) {
    case "checkout.session.async_payment_failed":
      target = "failed";
      break;
    case "checkout.session.expired":
      target = "expired";
      break;
    case "checkout.session.async_payment_succeeded":
      if (session.payment_status !== "paid") {
        return finishEvent(database, event, "quarantined", "async_success_not_paid");
      }
      target = "paid";
      break;
    default:
      if (session.payment_status === "paid") {
        target = "paid";
      } else if (session.payment_status === "unpaid") {
        target = "processing";
      } else {
        return finishEvent(database, event, "quarantined", "unsupported_payment_status");
      }
  }

  await applyCheckoutState(
    database,
    event,
    attempt,
    target,
    relatedObjectId(session.payment_intent),
  );
  return "processed";
}

async function processRefundEvent(
  database: Database,
  stripe: StripeClient,
  event: Stripe.ChargeRefundedEvent,
): Promise<EventOutcome> {
  const charge = event.data.object;
  const providerPaymentIntentId = relatedObjectId(charge.payment_intent);
  if (!providerPaymentIntentId || charge.amount_refunded <= 0) {
    return finishEvent(database, event, "quarantined", "refund_payment_intent_missing");
  }

  let attempt = await database.query.paymentAttempts.findFirst({
    where: eq(paymentAttempts.providerPaymentIntentId, providerPaymentIntentId),
  });
  if (!attempt) {
    const paymentIntent = await stripe.paymentIntents.retrieve(providerPaymentIntentId);
    const attemptId = paymentIntent.metadata.payment_attempt_id;
    if (attemptId) {
      attempt = await database.query.paymentAttempts.findFirst({
        where: eq(paymentAttempts.id, attemptId),
      });
      if (
        attempt &&
        (paymentIntent.metadata.bid_id !== attempt.bidId ||
          paymentIntent.amount !== attempt.amountCents ||
          paymentIntent.currency.toUpperCase() !== attempt.currency)
      ) {
        return finishEvent(database, event, "quarantined", "refund_payment_intent_mismatch");
      }
    }
  }
  if (!attempt) {
    return finishEvent(database, event, "quarantined", "refund_attempt_not_found");
  }
  if (charge.amount !== attempt.amountCents || charge.currency.toUpperCase() !== attempt.currency) {
    return finishEvent(database, event, "quarantined", "refund_charge_mismatch");
  }

  const target = charge.amount_refunded >= attempt.amountCents ? "refunded" : "partially_refunded";
  const now = Date.now();

  if (attempt.status === target) {
    await database
      .update(stripeEvents)
      .set({
        failureCode: null,
        paymentAttemptId: attempt.id,
        processedAt: now,
        status: "processed",
      })
      .where(eq(stripeEvents.id, event.id));
    return "processed";
  }

  await database.batch([
    database
      .update(paymentAttempts)
      .set({ providerPaymentIntentId, status: target, updatedAt: now })
      .where(eq(paymentAttempts.id, attempt.id)),
    database
      .update(bids)
      .set({ paymentStatus: target, paymentUpdatedAt: now })
      .where(eq(bids.id, attempt.bidId)),
    database
      .update(placements)
      .set({ status: "paused", updatedAt: now })
      .where(eq(placements.currentBidId, attempt.bidId)),
    database
      .insert(paymentTransitions)
      .values({
        bidId: attempt.bidId,
        createdAt: now,
        fromStatus: attempt.status,
        id: crypto.randomUUID(),
        paymentAttemptId: attempt.id,
        sourceId: event.id,
        sourceType: "webhook",
        toStatus: target,
      })
      .onConflictDoNothing(),
    database
      .update(stripeEvents)
      .set({
        failureCode: null,
        paymentAttemptId: attempt.id,
        processedAt: now,
        status: "processed",
      })
      .where(eq(stripeEvents.id, event.id)),
  ]);
  return "processed";
}

export async function processStripeEvent(
  database: Database,
  stripe: StripeClient,
  event: Stripe.Event,
): Promise<{ replayed: boolean; status: EventOutcome }> {
  const claimed = await claimEvent(database, event);
  if (!claimed) {
    const existing = await database.query.stripeEvents.findFirst({
      where: eq(stripeEvents.id, event.id),
    });
    return {
      replayed: true,
      status:
        existing?.status === "ignored" || existing?.status === "quarantined"
          ? existing.status
          : "processed",
    };
  }

  try {
    if (handledCheckoutEvents.has(event.type)) {
      return { replayed: false, status: await processCheckoutEvent(database, stripe, event) };
    }
    if (event.type === "charge.refunded") {
      return {
        replayed: false,
        status: await processRefundEvent(database, stripe, event),
      };
    }
    return {
      replayed: false,
      status: await finishEvent(database, event, "ignored", null),
    };
  } catch (error) {
    await database
      .update(stripeEvents)
      .set({ failureCode: "processing_failed", status: "failed" })
      .where(eq(stripeEvents.id, event.id));
    console.error(
      JSON.stringify({
        cause: error instanceof Error ? error.name : "UnknownError",
        code: "stripe_event_processing_failed",
        eventId: event.id,
        eventType: event.type,
      }),
    );
    if (error instanceof HttpProblem) {
      throw error;
    }
    throw new HttpProblem(503, "service_unavailable", "Stripe event processing failed.");
  }
}

export async function reconcilePayment(database: Database, stripe: StripeClient, bidId: string) {
  const attempt = await database.query.paymentAttempts.findFirst({
    orderBy: [desc(paymentAttempts.createdAt)],
    where: eq(paymentAttempts.bidId, bidId),
  });
  if (!attempt?.providerCheckoutSessionId) {
    throw new HttpProblem(404, "not_found", "No Stripe Checkout attempt exists for this bid.");
  }

  const session = await stripe.checkout.sessions.retrieve(attempt.providerCheckoutSessionId);
  let target: PaymentStatus;
  if (session.payment_status === "paid") {
    target = "paid";
  } else if (session.status === "expired") {
    target = "expired";
  } else if (session.status === "complete") {
    target = "processing";
  } else {
    target = "checkout_open";
  }

  const providerPaymentIntentId = relatedObjectId(session.payment_intent);
  if (target === "paid" && providerPaymentIntentId) {
    const paymentIntent = await stripe.paymentIntents.retrieve(providerPaymentIntentId);
    const latestChargeId = relatedObjectId(paymentIntent.latest_charge);
    if (latestChargeId) {
      const charge = await stripe.charges.retrieve(latestChargeId);
      if (charge.amount_refunded > 0) {
        target = charge.amount_refunded >= attempt.amountCents ? "refunded" : "partially_refunded";
      }
    }
  }

  const now = Date.now();
  await database.batch([
    database
      .update(paymentAttempts)
      .set({
        providerPaymentIntentId,
        status: target === "checkout_open" ? "open" : target,
        updatedAt: now,
      })
      .where(eq(paymentAttempts.id, attempt.id)),
    database
      .update(bids)
      .set({
        paidAt: target === "paid" ? now : undefined,
        paymentStatus: target,
        paymentUpdatedAt: now,
      })
      .where(eq(bids.id, bidId)),
    database
      .update(placements)
      .set({
        status: target === "refunded" || target === "partially_refunded" ? "paused" : "active",
        updatedAt: now,
      })
      .where(eq(placements.currentBidId, bidId)),
    database
      .insert(paymentTransitions)
      .values({
        bidId,
        createdAt: now,
        fromStatus: attempt.status,
        id: crypto.randomUUID(),
        paymentAttemptId: attempt.id,
        sourceId: `${attempt.id}:${target}:${providerPaymentIntentId ?? "none"}`,
        sourceType: "reconciliation",
        toStatus: target,
      })
      .onConflictDoNothing(),
  ]);

  return { bidId, paymentStatus: target };
}
