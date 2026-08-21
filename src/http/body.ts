import { HttpProblem } from "./problem";

export const JSON_BODY_LIMIT_BYTES = 16 * 1024;
export const STRIPE_WEBHOOK_LIMIT_BYTES = 1024 * 1024;

export async function readBoundedText(request: Request, maximumBytes: number): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new HttpProblem(413, "request_too_large", "Request body is too large.");
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let result = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    bytesRead += chunk.value.byteLength;
    if (bytesRead > maximumBytes) {
      await reader.cancel("request body limit exceeded");
      throw new HttpProblem(413, "request_too_large", "Request body is too large.");
    }
    result += decoder.decode(chunk.value, { stream: true });
  }

  return result + decoder.decode();
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpProblem(400, "bad_request", "Content-Type must be application/json.");
  }

  try {
    return JSON.parse(await readBoundedText(request, JSON_BODY_LIMIT_BYTES));
  } catch (error) {
    if (error instanceof HttpProblem) {
      throw error;
    }
    throw new HttpProblem(400, "bad_request", "Request body must contain valid JSON.");
  }
}
