const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function configuredPublicOrigin(value: string | undefined): string | null {
  const configured = value?.trim();
  if (!configured) {
    return null;
  }

  const url = new URL(configured);
  const localHttp = url.protocol === "http:" && localHosts.has(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("PUBLIC_ORIGIN must use HTTPS outside local development.");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PUBLIC_ORIGIN must be an origin without credentials, path, query, or hash.");
  }

  return url.origin;
}

export function resolvePublicOrigin(requestUrl: string, configuredOrigin: string | undefined) {
  return configuredPublicOrigin(configuredOrigin) ?? new URL(requestUrl).origin;
}

export function publicUrl(
  pathname: string,
  requestUrl: string,
  configuredOrigin: string | undefined,
) {
  return new URL(pathname, `${resolvePublicOrigin(requestUrl, configuredOrigin)}/`).href;
}

export function isCanonicalRequest(requestUrl: string, configuredOrigin: string | undefined) {
  const canonicalOrigin = configuredPublicOrigin(configuredOrigin);
  return canonicalOrigin === null || new URL(requestUrl).origin === canonicalOrigin;
}
