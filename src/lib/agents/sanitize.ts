export function isBlockedHref(href: string): boolean {
  const value = href.trim().toLowerCase();
  return (
    value.startsWith("javascript:") ||
    value.startsWith("data:") ||
    value.startsWith("file:") ||
    value.startsWith("vbscript:")
  );
}

export function isHttpHref(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

const ALLOWED_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "cli.github.com",
  "git-scm.com",
  "www.git-scm.com",
]);

export function isAllowedExternalHref(href: string): boolean {
  try {
    const url = new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      const host = url.hostname.toLowerCase();
      if (ALLOWED_HOSTS.has(host)) return true;
      return (host === "127.0.0.1" || host === "localhost") && url.protocol === "http:";
    }
    return false;
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
