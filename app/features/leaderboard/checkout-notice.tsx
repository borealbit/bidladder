import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

type NoticeState =
  | { kind: "cancelled"; message: string }
  | { kind: "error" | "paid" | "processing"; message: string }
  | null;

export function CheckoutNotice() {
  const [searchParams] = useSearchParams();
  const checkout = searchParams.get("checkout");
  const bidId = searchParams.get("bid");
  const [notice, setNotice] = useState<NoticeState>(() =>
    checkout === "cancelled"
      ? { kind: "cancelled", message: "Checkout was cancelled. Your bid is still saved." }
      : checkout === "success"
        ? { kind: "processing", message: "Waiting for Stripe to confirm your payment…" }
        : null,
  );
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (checkout !== "success" || !bidId) {
      return;
    }

    const controller = new AbortController();
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      attempt += 1;
      try {
        const response = await fetch(
          `/api/v1/bids/${encodeURIComponent(bidId as string)}/payment`,
          {
            signal: controller.signal,
          },
        );
        const result = (await response.json()) as {
          data?: { paymentStatus?: string };
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(result.error?.message ?? "Payment status is unavailable.");
        }

        const paymentStatus = result.data?.paymentStatus;
        if (paymentStatus === "paid") {
          setNotice({
            kind: "paid",
            message: "Payment received. Your bid is now waiting for maintainer review.",
          });
          return;
        }
        if (paymentStatus === "failed" || paymentStatus === "expired") {
          setNotice({
            kind: "error",
            message: "Stripe did not complete this payment. You can start checkout again.",
          });
          return;
        }

        setNotice({
          kind: "processing",
          message: "Payment is processing. Placement starts only after Stripe confirms it.",
        });
        if (attempt < 6) {
          timer = setTimeout(() => void refresh(), 2_000);
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setNotice({
          kind: "error",
          message: error instanceof Error ? error.message : "Payment status is unavailable.",
        });
      }
    }

    void refresh();
    return () => {
      controller.abort();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [bidId, checkout]);

  if (!notice || !bidId) {
    return null;
  }

  async function retryCheckout() {
    setRetrying(true);
    try {
      const response = await fetch(`/api/v1/bids/${encodeURIComponent(bidId as string)}/checkout`, {
        method: "POST",
      });
      const result = (await response.json()) as {
        data?: { checkoutUrl?: string };
        error?: { message?: string };
      };
      if (!response.ok || !result.data?.checkoutUrl) {
        throw new Error(result.error?.message ?? "Stripe Checkout could not be started.");
      }
      window.location.assign(result.data.checkoutUrl);
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Stripe Checkout could not be started.",
      });
      setRetrying(false);
    }
  }

  return (
    <section className={`checkout-notice checkout-notice--${notice.kind} page-frame`} role="status">
      <p>{notice.message}</p>
      {notice.kind === "cancelled" || notice.kind === "error" ? (
        <button
          className="button button-secondary button-small"
          disabled={retrying}
          onClick={() => void retryCheckout()}
          type="button"
        >
          {retrying ? "Opening…" : "Resume payment"}
        </button>
      ) : null}
    </section>
  );
}
