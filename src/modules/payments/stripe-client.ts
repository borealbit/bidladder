import Stripe from "stripe";

import { HttpProblem } from "../../http/problem";

export type StripeClient = Stripe;

function requireSecret(value: string | undefined, name: string, prefix: string): string {
  if (!value?.startsWith(prefix)) {
    throw new HttpProblem(
      503,
      "service_unavailable",
      `${name} is not configured for this deployment.`,
    );
  }
  return value;
}

export function createStripeClient(environment: Env): StripeClient {
  const apiKey = environment.STRIPE_API_KEY;
  if (!apiKey || (!apiKey.startsWith("rk_") && !apiKey.startsWith("sk_"))) {
    throw new HttpProblem(
      503,
      "service_unavailable",
      "Stripe API access is not configured for this deployment.",
    );
  }

  return new Stripe(apiKey, {
    appInfo: {
      name: "BidLadder",
      url: "https://github.com/borealbit/bidladder",
      version: "0.1.0",
    },
    maxNetworkRetries: 2,
    timeout: 10_000,
  });
}

export async function verifyStripeEvent(
  stripe: StripeClient,
  rawBody: string,
  signature: string | null,
  webhookSecret: string | undefined,
): Promise<Stripe.Event> {
  if (!signature) {
    throw new HttpProblem(400, "bad_request", "Stripe-Signature header is required.");
  }
  const secret = requireSecret(webhookSecret, "Stripe webhook signing secret", "whsec_");

  try {
    return await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch {
    throw new HttpProblem(400, "bad_request", "Stripe webhook signature is invalid.");
  }
}
