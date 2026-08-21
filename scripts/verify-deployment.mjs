const rawBaseUrl =
  process.argv.slice(2).find((argument) => argument !== "--") ?? process.env.BIDLADDER_BASE_URL;

if (!rawBaseUrl) {
  throw new Error("Usage: pnpm verify:deployment -- https://your-bidladder.example");
}

const baseUrl = new URL(rawBaseUrl);
if (baseUrl.username || baseUrl.password) {
  throw new Error("The deployment URL must not contain credentials.");
}
if (
  baseUrl.protocol !== "https:" &&
  !(baseUrl.protocol === "http:" && ["127.0.0.1", "localhost"].includes(baseUrl.hostname))
) {
  throw new Error("Use HTTPS for remote deployment verification.");
}
baseUrl.pathname = "/";
baseUrl.search = "";
baseUrl.hash = "";

const checks = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(pathname, init) {
  return fetch(new URL(pathname, baseUrl), {
    ...init,
    headers: {
      "User-Agent": "BidLadder deployment verifier/0.1.0",
      ...init?.headers,
    },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
}

async function check(name, callback) {
  try {
    await callback();
    checks.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, passed: false });
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await check("health and security headers", async () => {
  const response = await request("/health");
  assert(response.status === 200, `expected 200, received ${response.status}`);
  const body = await response.json();
  assert(body.service === "bidladder" && body.status === "ok", "unexpected health response");
  assert(response.headers.get("x-content-type-options") === "nosniff", "nosniff is missing");
  assert(response.headers.get("x-frame-options") === "DENY", "frame denial is missing");
  assert(response.headers.has("strict-transport-security"), "HSTS is missing");
});

await check("server-rendered home page", async () => {
  const response = await request("/");
  assert(response.status === 200, `expected 200, received ${response.status}`);
  const html = await response.text();
  assert(html.includes("BidLadder"), "home page does not identify BidLadder");
  assert(html.includes('rel="canonical"'), "home page canonical is missing");
  assert(html.includes(baseUrl.href), "home page canonical does not use the verified origin");
});

await check("public leaderboard API", async () => {
  const response = await request("/api/v1/leaderboards/main");
  assert(response.status === 200, `expected 200, received ${response.status}`);
  const body = await response.json();
  assert(Array.isArray(body.data?.placements), "leaderboard placements are missing");
});

await check("JSON API miss boundary", async () => {
  const response = await request("/api/verification-miss");
  assert(response.status === 404, `expected 404, received ${response.status}`);
  assert(response.headers.get("content-type")?.includes("application/json"), "expected JSON");
  const body = await response.json();
  assert(body.error?.code === "not_found", "unexpected API error code");
});

await check("admin authentication boundary", async () => {
  const response = await request("/api/v1/admin/bids?status=pending");
  assert(response.status === 401, `expected 401, received ${response.status}`);
});

await check("Stripe webhook signature boundary", async () => {
  const response = await request("/api/v1/webhooks/stripe", {
    body: "{}",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assert(response.status === 400, `expected 400, received ${response.status}`);
  const body = await response.json();
  assert(body.error?.code === "bad_request", "unexpected webhook error code");
});

await check("robots and sitemap", async () => {
  const [robots, sitemap] = await Promise.all([request("/robots.txt"), request("/sitemap.xml")]);
  const robotsText = await robots.text();
  const sitemapText = await sitemap.text();
  assert(robots.status === 200 && robotsText.includes("Allow: /"), "bad robots");
  assert(!robotsText.includes("Disallow: /admin"), "admin noindex is blocked by robots");
  assert(robotsText.includes(new URL("/sitemap.xml", baseUrl).href), "wrong sitemap origin");
  assert(sitemap.status === 200 && sitemapText.includes("<urlset"), "bad sitemap");
  for (const pathname of ["/", "/rules", "/deploy"]) {
    assert(sitemapText.includes(new URL(pathname, baseUrl).href), `sitemap is missing ${pathname}`);
  }
});

const failures = checks.filter((entry) => !entry.passed).length;
console.log(
  `\n${checks.length - failures}/${checks.length} deployment checks passed for ${baseUrl.origin}.`,
);
if (failures > 0) {
  process.exitCode = 1;
}
