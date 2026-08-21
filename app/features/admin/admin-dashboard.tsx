import { type FormEvent, useCallback, useEffect, useState } from "react";

type BidStatus = "approved" | "pending" | "rejected";

interface AdminBid {
  amountCents: number;
  contactEmail: string;
  currency: string;
  id: string;
  name: string;
  paymentStatus:
    | "checkout_open"
    | "checkout_pending"
    | "expired"
    | "failed"
    | "paid"
    | "partially_refunded"
    | "processing"
    | "refunded"
    | "unpaid";
  status: BidStatus;
  submittedAt: number;
  tagline: string;
  websiteUrl: string;
}

const SESSION_KEY = "bidladder-admin-key";

function formatBid(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { currency, style: "currency" }).format(amountCents / 100);
}

export function AdminDashboard() {
  const [tokenInput, setTokenInput] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<BidStatus>("pending");
  const [bids, setBids] = useState<AdminBid[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const loadBids = useCallback(async (adminKey: string, filter: BidStatus) => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/bids?status=${filter}`, {
        headers: { Authorization: `Bearer ${adminKey}` },
      });
      const result = (await response.json()) as {
        data?: AdminBid[];
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(result.error?.message ?? "Could not load bids.");
      }
      setBids(result.data ?? []);
      setToken(adminKey);
      sessionStorage.setItem(SESSION_KEY, adminKey);
    } catch (error) {
      setBids([]);
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not load bids.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const savedToken = sessionStorage.getItem(SESSION_KEY);
    if (savedToken) {
      setTokenInput(savedToken);
      void loadBids(savedToken, "pending");
    }
  }, [loadBids]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadBids(tokenInput, status);
  }

  async function changeFilter(nextStatus: BidStatus) {
    setStatus(nextStatus);
    if (token) {
      await loadBids(token, nextStatus);
    }
  }

  async function decide(bid: AdminBid, decision: "approved" | "rejected") {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/bids/${bid.id}/decision`, {
        body: JSON.stringify({ decision }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const result = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(result.error?.message ?? "Could not update the bid.");
      }
      setBids((current) => current.filter((item) => item.id !== bid.id));
      setMessage({ kind: "success", text: `Bid ${decision} for ${bid.name}.` });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not update the bid.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function reconcile(bid: AdminBid) {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/payments/${bid.id}/reconcile`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "POST",
      });
      const result = (await response.json()) as {
        data?: { paymentStatus?: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(result.error?.message ?? "Could not reconcile this payment.");
      }
      await loadBids(token, status);
      setMessage({
        kind: "success",
        text: `Payment reconciled for ${bid.name}: ${result.data?.paymentStatus ?? "updated"}.`,
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not reconcile this payment.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-surface">
      <section aria-labelledby="admin-access-title" className="admin-access">
        <form onSubmit={unlock}>
          <h2 id="admin-access-title">Admin access</h2>
          <label htmlFor="admin-key">
            <span>Admin key</span>
          </label>
          <div className="admin-unlock-row">
            <input
              autoComplete="off"
              id="admin-key"
              onChange={(event) => setTokenInput(event.target.value)}
              required
              type="password"
              value={tokenInput}
            />
            <button className="button button-primary" disabled={loading} type="submit">
              {loading ? "Checking…" : "Unlock dashboard"}
            </button>
          </div>
          <p>Stored in this tab only.</p>
        </form>
        <div className="admin-access-note">
          <span aria-hidden="true" className="lock-icon">
            ⌑
          </span>
          <p>Enter your admin key to unlock the moderation dashboard.</p>
        </div>
      </section>

      {message ? (
        <div className={`notice notice--${message.kind}`} role="status">
          {message.text}
        </div>
      ) : null}

      {token ? (
        <section aria-labelledby="bid-table-title" className="admin-bids">
          <h2 className="sr-only" id="bid-table-title">
            Bid submissions
          </h2>
          <div className="admin-tabs" role="tablist" aria-label="Bid status">
            {(["pending", "approved", "rejected"] as const).map((value) => (
              <button
                aria-selected={status === value}
                className={status === value ? "active" : ""}
                key={value}
                onClick={() => void changeFilter(value)}
                role="tab"
                type="button"
              >
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
            <span>
              {bids.length} {status}
            </span>
          </div>

          {bids.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Sponsor</th>
                    <th>Website</th>
                    <th>Bid</th>
                    <th>Payment</th>
                    <th>Submitted</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bids.map((bid) => (
                    <tr key={bid.id}>
                      <td data-label="Sponsor">
                        <strong>{bid.name}</strong>
                        <span>{bid.tagline}</span>
                      </td>
                      <td data-label="Website">
                        <a href={bid.websiteUrl} rel="noreferrer" target="_blank">
                          {new URL(bid.websiteUrl).host} ↗
                        </a>
                        <span>{bid.contactEmail}</span>
                      </td>
                      <td className="table-money" data-label="Bid">
                        {formatBid(bid.amountCents, bid.currency)}
                      </td>
                      <td data-label="Payment">
                        <span className={`status-label status-label--${bid.paymentStatus}`}>
                          {bid.paymentStatus.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td data-label="Submitted">
                        {new Intl.DateTimeFormat("en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(bid.submittedAt)}
                      </td>
                      <td data-label="Status">
                        <span className={`status-label status-label--${bid.status}`}>
                          {bid.status}
                        </span>
                      </td>
                      <td data-label="Actions">
                        {bid.status === "pending" ? (
                          <div className="row-actions">
                            <button
                              className="button button-primary button-small"
                              disabled={loading || bid.paymentStatus !== "paid"}
                              onClick={() => void decide(bid, "approved")}
                              title={
                                bid.paymentStatus === "paid"
                                  ? "Approve this paid bid"
                                  : "Stripe must confirm full payment before approval"
                              }
                              type="button"
                            >
                              Approve
                            </button>
                            <button
                              className="button button-secondary button-small"
                              disabled={loading}
                              onClick={() => void decide(bid, "rejected")}
                              type="button"
                            >
                              Reject
                            </button>
                            <button
                              className="button button-secondary button-small"
                              disabled={loading}
                              onClick={() => void reconcile(bid)}
                              type="button"
                            >
                              Reconcile
                            </button>
                          </div>
                        ) : (
                          <span>Reviewed</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="admin-empty">No {status} bids</div>
          )}
        </section>
      ) : null}
    </div>
  );
}
