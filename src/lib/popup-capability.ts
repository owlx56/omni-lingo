export type PopupCapability = "web" | "reader" | "options" | "unsupported";

const UNSUPPORTED_WEB_HOSTS = new Set([
  "addons.mozilla.org",
  "chrome.google.com",
  "chromewebstore.google.com",
  "microsoftedge.microsoft.com",
]);

const SUPPORTED_WEB_PROTOCOLS = new Set(["http:", "https:", "file:"]);

const READER_PATHS = new Set([
  "/pdf/web/viewer.html",
  "/foliate/web/viewer.html",
  "/viewer.html",
]);

export function classifyPopupCapability(
  tabUrl: string | undefined,
  extensionBaseUrl: string,
): PopupCapability {
  if (!tabUrl) return "unsupported";

  let url: URL;
  try {
    url = new URL(tabUrl);
  } catch {
    return "unsupported";
  }

  if (isOwnExtensionUrl(url, extensionBaseUrl)) {
    if (url.pathname === "/options.html") return "options";
    if (READER_PATHS.has(url.pathname)) return "reader";
    return "unsupported";
  }

  if (!SUPPORTED_WEB_PROTOCOLS.has(url.protocol)) return "unsupported";
  if (isProtectedWebStoreUrl(url)) return "unsupported";
  return "web";
}

export function popupPathForCapability(
  _capability: PopupCapability,
): string {
  return "popup.html";
}

export function popupShowsPageControls(capability: PopupCapability): boolean {
  return capability === "web";
}

export function popupShowsFeatureControls(capability: PopupCapability): boolean {
  return capability === "web" || capability === "reader";
}

function isOwnExtensionUrl(url: URL, extensionBaseUrl: string): boolean {
  let base: URL;
  try {
    base = new URL(extensionBaseUrl);
  } catch {
    return false;
  }
  return url.protocol === base.protocol && url.host === base.host;
}

function isProtectedWebStoreUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (UNSUPPORTED_WEB_HOSTS.has(host)) return true;
  return (
    host.endsWith(".chrome.google.com") ||
    host.endsWith(".chromewebstore.google.com") ||
    host.endsWith(".addons.mozilla.org")
  );
}
