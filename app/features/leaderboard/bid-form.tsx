import { type FormEvent, useEffect, useRef, useState } from "react";

type SubmissionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { bidId?: string; message: string; status: "error" | "success" };

type ListingDetails = {
  contactEmail: string;
  logoUrl: string;
  name: string;
  tagline: string;
};

function summarizeWebsite(websiteUrl: string) {
  try {
    const url = new URL(websiteUrl);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.host}${pathname}`;
  } catch {
    return websiteUrl;
  }
}

function formatContribution(amount: string, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: "currency",
  }).format(Number(amount));
}

export function BidForm({
  bidIncrementCents,
  currency,
  minimumBidCents,
  suggestedAmountCents,
}: {
  bidIncrementCents: number;
  currency: string;
  minimumBidCents: number;
  suggestedAmountCents: number;
}) {
  const [state, setState] = useState<SubmissionState>({ status: "idle" });
  const [stage, setStage] = useState<"details" | "essentials">("essentials");
  const [amount, setAmount] = useState((suggestedAmountCents / 100).toFixed(2));
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [listingDetails, setListingDetails] = useState<ListingDetails>({
    contactEmail: "",
    logoUrl: "",
    name: "",
    tagline: "",
  });
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    function prefillBid(event: Event) {
      const detail = (event as CustomEvent<{ amountCents?: number }>).detail;
      if (detail?.amountCents) {
        setAmount((detail.amountCents / 100).toFixed(2));
      }
    }
    window.addEventListener("bidladder:prefill-bid", prefillBid);
    return () => window.removeEventListener("bidladder:prefill-bid", prefillBid);
  }, []);

  async function openCheckout(bidId: string) {
    const response = await fetch(`/api/v1/bids/${encodeURIComponent(bidId)}/checkout`, {
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
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stage === "essentials") {
      setStage("details");
      return;
    }
    setState({ status: "submitting" });
    idempotencyKey.current ??= crypto.randomUUID();

    const payload = {
      amount: Number(amount),
      ...listingDetails,
      websiteUrl,
    };

    try {
      const response = await fetch("/api/v1/leaderboards/main/bids", {
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        method: "POST",
      });
      const result = (await response.json()) as {
        data?: { bidId?: string };
        error?: { message?: string };
      };
      const bidId = result.data?.bidId;
      if (!response.ok || !bidId) {
        throw new Error(result.error?.message ?? "The bid could not be submitted.");
      }

      try {
        await openCheckout(bidId);
      } catch (error) {
        setState({
          bidId,
          message:
            error instanceof Error
              ? `Bid saved, but payment could not start: ${error.message}`
              : "Bid saved, but payment could not start.",
          status: "error",
        });
      }
    } catch (error) {
      setState({
        message: error instanceof Error ? error.message : "The bid could not be submitted.",
        status: "error",
      });
    }
  }

  const submitting = state.status === "submitting";

  return (
    <section aria-labelledby="bid-form-title" className="bid-panel" id="place-bid">
      <div className="bid-panel-heading">
        <div>
          <h2 id="bid-form-title">Sponsor a position</h2>
          <p>
            {stage === "essentials" ? "Start with the essentials." : "Review the listing details."}
          </p>
        </div>
        <span className="form-step">{stage === "essentials" ? "01 / 02" : "02 / 02"}</span>
      </div>

      <form className="bid-form" onSubmit={handleSubmit}>
        {stage === "essentials" ? (
          <>
            <label className="field-wide">
              <span>Product URL</span>
              <input
                autoComplete="url"
                name="websiteUrl"
                onChange={(event) => setWebsiteUrl(event.target.value)}
                placeholder="https://yourproduct.com"
                required
                type="url"
                value={websiteUrl}
              />
            </label>
            <label className="field-wide">
              <span>Contribution ({currency})</span>
              <div className="amount-stepper">
                <button
                  aria-label="Decrease contribution"
                  onClick={() =>
                    setAmount((current) =>
                      (
                        Math.max(
                          minimumBidCents,
                          Math.round(Number(current) * 100) - bidIncrementCents,
                        ) / 100
                      ).toFixed(2),
                    )
                  }
                  type="button"
                >
                  −
                </button>
                <span aria-hidden="true">$</span>
                <input
                  inputMode="decimal"
                  min={minimumBidCents / 100}
                  name="amount"
                  onChange={(event) => setAmount(event.target.value)}
                  required
                  step={bidIncrementCents / 100}
                  type="number"
                  value={amount}
                />
                <button
                  aria-label="Increase contribution"
                  onClick={() =>
                    setAmount((current) =>
                      ((Math.round(Number(current) * 100) + bidIncrementCents) / 100).toFixed(2),
                    )
                  }
                  type="button"
                >
                  +
                </button>
              </div>
            </label>
          </>
        ) : (
          <fieldset className="bid-summary field-wide">
            <legend className="sr-only">Sponsorship summary</legend>
            <strong>{summarizeWebsite(websiteUrl)}</strong>
            <p>
              Contribution: <span>{formatContribution(amount, currency)}</span>
            </p>
          </fieldset>
        )}

        {stage === "details" ? (
          <>
            <label>
              <span>Sponsor name</span>
              <input
                autoComplete="organization"
                name="name"
                onChange={(event) =>
                  setListingDetails((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Acme Cloud"
                required
                value={listingDetails.name}
              />
            </label>
            <label>
              <span>Contact email</span>
              <input
                autoComplete="email"
                name="contactEmail"
                onChange={(event) =>
                  setListingDetails((current) => ({
                    ...current,
                    contactEmail: event.target.value,
                  }))
                }
                placeholder="you@acme.com"
                required
                type="email"
                value={listingDetails.contactEmail}
              />
            </label>
            <label className="field-wide">
              <span>Tagline</span>
              <input
                name="tagline"
                onChange={(event) =>
                  setListingDetails((current) => ({ ...current, tagline: event.target.value }))
                }
                placeholder="What should visitors know?"
                required
                value={listingDetails.tagline}
              />
            </label>
            <label className="field-wide">
              <span>Logo URL (optional)</span>
              <input
                name="logoUrl"
                onChange={(event) =>
                  setListingDetails((current) => ({ ...current, logoUrl: event.target.value }))
                }
                placeholder="https://yourproduct.com/logo.png"
                type="url"
                value={listingDetails.logoUrl}
              />
            </label>
          </>
        ) : null}

        {stage === "details" ? (
          <div className="form-actions field-wide">
            <button
              className="button button-secondary"
              disabled={submitting}
              onClick={() => {
                setStage("essentials");
                setState({ status: "idle" });
                idempotencyKey.current = null;
              }}
              type="button"
            >
              <span aria-hidden="true">←</span> Back
            </button>
            <button className="button button-primary" disabled={submitting} type="submit">
              {submitting ? "Opening Stripe…" : "Continue to payment"}
            </button>
          </div>
        ) : (
          <button className="button button-primary field-wide" type="submit">
            Review sponsorship
          </button>
        )}

        <p className="form-note field-wide">
          Contributions add to the product&apos;s lifetime total. Paid submissions are reviewed
          before publication; rejected listings must be refunded in full by the operator.
        </p>
        {state.status === "success" || state.status === "error" ? (
          <div className={`form-message form-message--${state.status} field-wide`} role="status">
            <p>{state.message}</p>
            {state.status === "error" && state.bidId ? (
              <button
                className="button button-secondary button-small"
                onClick={() => {
                  setState({ status: "submitting" });
                  void openCheckout(state.bidId as string).catch((error: unknown) => {
                    setState({
                      bidId: state.bidId,
                      message:
                        error instanceof Error
                          ? `Payment still could not start: ${error.message}`
                          : "Payment still could not start.",
                      status: "error",
                    });
                  });
                }}
                type="button"
              >
                Retry payment
              </button>
            ) : null}
          </div>
        ) : null}
      </form>
    </section>
  );
}
