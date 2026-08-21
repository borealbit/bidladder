import { createContext } from "react-router";

export interface WorkerExecutionContext {
  passThroughOnException(): void;
  waitUntil(promise: Promise<unknown>): void;
}

export interface CloudflareRequestContext {
  env: Env;
  executionContext: WorkerExecutionContext;
}

export const cloudflareRequestContext = createContext<CloudflareRequestContext>();
