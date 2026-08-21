import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("rules", "routes/rules.tsx"),
  route("deploy", "routes/deploy.tsx"),
  route("admin", "routes/admin.tsx"),
] satisfies RouteConfig;
