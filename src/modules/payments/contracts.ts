export const paymentStatuses = [
  "unpaid",
  "checkout_pending",
  "checkout_open",
  "processing",
  "paid",
  "partially_refunded",
  "refunded",
  "failed",
  "expired",
] as const;

export type PaymentStatus = (typeof paymentStatuses)[number];

export interface CheckoutResult {
  bidId: string;
  checkoutUrl: string;
  paymentStatus: "checkout_open";
}

export interface PaymentSummary {
  bidId: string;
  moderationStatus: "approved" | "pending" | "rejected";
  paymentStatus: PaymentStatus;
}
