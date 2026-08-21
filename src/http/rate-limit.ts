import { HttpProblem } from "./problem";

export async function rateLimitKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function requestNetworkIdentity(request: Request): string | null {
  const connectingIp = request.headers.get("cf-connecting-ip")?.trim();
  return connectingIp ? connectingIp : null;
}

export async function enforceRateLimit(binding: RateLimit, key: string): Promise<void> {
  let allowed = false;
  try {
    ({ success: allowed } = await binding.limit({ key }));
  } catch (error) {
    console.error(
      JSON.stringify({
        cause: error instanceof Error ? error.name : "UnknownError",
        code: "rate_limit_unavailable",
      }),
    );
    throw new HttpProblem(
      503,
      "service_unavailable",
      "Request protection is temporarily unavailable.",
    );
  }

  if (!allowed) {
    throw new HttpProblem(429, "rate_limited", "Too many requests. Try again in one minute.");
  }
}
