import { IngestionError } from "./errors.ts";

export function httpUrl(value: string, base?: string): string {
  const url = new URL(value, base);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new IngestionError("UNSAFE_URL");
  }
  url.hash = "";
  return url.href;
}

export function safeLogUrl(value: string): string | null {
  try {
    const url = new URL(httpUrl(value));
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}
