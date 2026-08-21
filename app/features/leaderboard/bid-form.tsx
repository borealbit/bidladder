import { type FormEvent, useState } from "react";

type SubmissionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { message: string; status: "error" | "success" };

export function BidForm({
  currency,
  minimumBidCents,
}: {
  currency: string;
  minimumBidCents: number;
}) {
  const [state, setState] = useState<SubmissionState>({ status: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "submitting" });

    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      amount: Number(data.get("amount")),
      contactEmail: String(data.get("contactEmail") ?? ""),
      logoUrl: String(data.get("logoUrl") ?? ""),
      name: String(data.get("name") ?? ""),
      tagline: String(data.get("tagline") ?? ""),
      websiteUrl: String(data.get("websiteUrl") ?? ""),
    };

    try {
      const response = await fetch("/api/v1/leaderboards/main/bids", {
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        method: "POST",
      });
      const result = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(result.error?.message ?? "The bid could not be submitted.");
      }

      form.reset();
      setState({
        message: "Bid received. It will appear on the ladder after review.",
        status: "success",
      });
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
        <h2 id="bid-form-title">Place your bid</h2>
        <p>
          Minimum{" "}
          {new Intl.NumberFormat("en-US", { currency, style: "currency" }).format(
            minimumBidCents / 100,
          )}
        </p>
      </div>

      <form className="bid-form" onSubmit={handleSubmit}>
        <label>
          <span>Sponsor name</span>
          <input autoComplete="organization" name="name" placeholder="Acme Cloud" required />
        </label>
        <label>
          <span>Website</span>
          <input
            autoComplete="url"
            name="websiteUrl"
            placeholder="https://acme.com"
            required
            type="url"
          />
        </label>
        <label className="field-wide">
          <span>Tagline</span>
          <input name="tagline" placeholder="Performance you can count on." required />
        </label>
        <label>
          <span>Logo URL (optional)</span>
          <input name="logoUrl" placeholder="https://acme.com/logo.png" type="url" />
        </label>
        <label>
          <span>Contact email</span>
          <input
            autoComplete="email"
            name="contactEmail"
            placeholder="you@acme.com"
            required
            type="email"
          />
        </label>
        <label className="field-wide">
          <span>Bid amount ({currency})</span>
          <div className="amount-input">
            <span aria-hidden="true">$</span>
            <input
              inputMode="decimal"
              min={minimumBidCents / 100}
              name="amount"
              placeholder={(minimumBidCents / 100).toFixed(2)}
              required
              step="0.01"
              type="number"
            />
          </div>
        </label>

        <button className="button button-primary field-wide" disabled={submitting} type="submit">
          {submitting ? "Submitting…" : "Submit for review"}
        </button>

        <p className="form-note field-wide">
          All bids are reviewed before appearing on the leaderboard.
        </p>
        {state.status === "success" || state.status === "error" ? (
          <p className={`form-message form-message--${state.status} field-wide`} role="status">
            {state.message}
          </p>
        ) : null}
      </form>
    </section>
  );
}
