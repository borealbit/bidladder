import { createRequestHandler, RouterContextProvider } from "react-router";

import { cloudflareRequestContext } from "../src/http/react-router-context";
import { createServer } from "../src/server/app";

const reactRouterHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

const server = createServer(async (request, env, executionContext) => {
  const routerContext = new RouterContextProvider();
  routerContext.set(cloudflareRequestContext, { env, executionContext });
  return reactRouterHandler(request, routerContext);
});

export default {
  fetch: server.fetch,
} satisfies ExportedHandler<Env>;
