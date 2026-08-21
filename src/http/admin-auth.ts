import { HttpProblem } from "./problem";

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requireAdmin(request: Request, configuredHash: string | undefined) {
  if (!configuredHash || !SHA256_HEX_PATTERN.test(configuredHash)) {
    throw new HttpProblem(
      503,
      "service_unavailable",
      "Admin access is not configured for this deployment.",
    );
  }

  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) {
    throw new HttpProblem(401, "unauthorized", "A bearer admin key is required.");
  }

  const presentedHash = await sha256Hex(token);
  if (!constantTimeEqual(hexToBytes(presentedHash), hexToBytes(configuredHash.toLowerCase()))) {
    throw new HttpProblem(401, "unauthorized", "The bearer admin key is invalid.");
  }
}
