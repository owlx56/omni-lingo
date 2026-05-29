import { defineConfig } from "wxt";
import { access, readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import "./scripts/generate-i18n";

type PublicAssetFile =
  | {
      absoluteSrc: string;
      relativeDest: string;
    }
  | {
      contents: string;
      relativeDest: string;
    };

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const PDF_VIEWER_ASSET_DIR = join(ROOT_DIR, "src", "assets", "pdf-viewer");
const PDFJS_UPSTREAM_DIR = join(PDF_VIEWER_ASSET_DIR, "upstream");
const EPUB_VIEWER_ASSET_DIR = join(ROOT_DIR, "src", "assets", "epub-viewer");
const INTER_FONT_DIR = join(ROOT_DIR, "src", "assets", "fonts", "inter");
const PDF_VIEWER_LOCALE_ALIASES: Record<string, string[]> = {
  "bookmark1.title": ["bookmark.title"],
  bookmark1_label: ["bookmark_label"],
  "save.title": ["download.title"],
  save_label: ["download_label"],
  "editor_free_text2.title": ["editor_free_text.title"],
  editor_free_text2_label: ["editor_free_text_label"],
  editor_free_text2_aria_label: ["editor_free_text_aria_label"],
  "editor_ink2.title": ["editor_ink.title"],
  editor_ink2_label: ["editor_ink_label"],
  editor_ink2_aria_label: ["editor_ink_aria_label"],
};

type ViewerProperties = {
  keysInOrder: string[];
  values: Map<string, string>;
};

function toPublicPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function addFileAsset(
  files: PublicAssetFile[],
  absoluteSrc: string,
  relativeDest: string,
): void {
  files.push({
    absoluteSrc,
    relativeDest: toPublicPath(relativeDest),
  });
}

function addTextAsset(
  files: PublicAssetFile[],
  contents: string,
  relativeDest: string,
): void {
  files.push({
    contents,
    relativeDest: toPublicPath(relativeDest),
  });
}

function patchPdfJsCanvasReadback(contents: string): string {
  const target = 'context: canvas.getContext("2d")';
  const replacement =
    'context: canvas.getContext("2d", { willReadFrequently: true })';
  if (contents.includes(target)) {
    return contents.replace(target, replacement);
  }
  if (!contents.includes("willReadFrequently")) {
    throw new Error("Unable to patch PDF.js canvas factory for readback hints.");
  }
  return contents;
}

function patchPdfViewerHtml(contents: string): string {
  let next = contents.replace(
    /<title>[\s\S]*?<\/title>/,
    "<title>OneLingo PDF Viewer</title>",
  );
  if (next.includes('src="/pdf-viewer.js"')) return next;

  const buildScript =
    /<script src="\.\.\/build\/pdf\.(?:js|mjs)"(?: type="module")?><\/script>/;
  if (!buildScript.test(next)) {
    throw new Error("Unable to locate PDF.js build script in viewer.html.");
  }
  next = next.replace(
    buildScript,
    (match) => `${match}\n<script src="/pdf-viewer.js"></script>`,
  );
  return next;
}

function patchPdfViewerScript(contents: string, filename: string): string {
  let next = contents.startsWith("/* OneLingo:")
    ? contents
    : `/* OneLingo: official PDF.js viewer, patched at build time. */\n${contents}`;

  const defaultUrl =
    /defaultOptions\.defaultUrl\s*=\s*\{[\s\S]*?value:\s*(['"])(?:[^'"]*?\.pdf|[^'"]+)\1,[\s\S]*?kind:\s*OptionKind\.VIEWER[\s\S]*?\};/;
  if (!defaultUrl.test(next)) {
    throw new Error(`Unable to locate default PDF URL in ${filename}.`);
  }
  next = next.replace(defaultUrl, (match) =>
    match.replace(/value:\s*(['"])(?:[^'"]*?\.pdf|[^'"]+)\1/, 'value: ""'),
  );

  if (!next.includes("OneLingo: extension viewer opens external file URLs")) {
    const validateCall = "validateFileURL(file);";
    if (!next.includes(validateCall)) {
      throw new Error(`Unable to locate validateFileURL(file) in ${filename}.`);
    }
    next = next.replace(
      validateCall,
      "/* OneLingo: extension viewer opens external file URLs. */",
    );
  }

  if (!next.includes("window.PDFViewerApplication")) {
    const exportLine = "exports.PDFViewerApplication = PDFViewerApplication;";
    if (next.includes(exportLine)) {
      next = next.replace(
        exportLine,
        `${exportLine}\nwindow.PDFViewerApplication = PDFViewerApplication;`,
      );
    } else if (!/\bPDFViewerApplication\s*=\s*\{/.test(next)) {
      throw new Error(`Unable to expose PDFViewerApplication in ${filename}.`);
    }
  }

  return next;
}

function patchPdfViewerLocaleContents(
  contents: string,
  fallbackProps: ViewerProperties,
): string {
  const localeProps = parseViewerProperties(contents);
  const missingKeys = fallbackProps.keysInOrder.filter(
    (key) => !localeProps.values.has(key),
  );
  if (missingKeys.length === 0) return contents;

  const lines = missingKeys
    .map((key) => {
      const value = resolveViewerLocaleFallbackValue(key, localeProps, fallbackProps);
      return value === null ? null : `${key}=${value}`;
    })
    .filter((line): line is string => line !== null);
  if (lines.length === 0) return contents;

  return `${contents.replace(/\s*$/, "")}\n${lines.join("\n")}\n`;
}

function parseViewerProperties(contents: string): ViewerProperties {
  const keysInOrder: string[] = [];
  const values = new Map<string, string>();

  for (const line of contents.split(/\r?\n/)) {
    if (!line || /^\s*[#!]/.test(line)) continue;
    const match = line.match(/^([^=:\s]+(?:\s+[^=:\s]+)?)\s*[=:]\s*(.*)$/);
    if (!match) continue;
    const rawKey = match[1];
    const value = match[2];
    if (rawKey === undefined || value === undefined) continue;
    const key = rawKey.trim();
    if (!values.has(key)) keysInOrder.push(key);
    values.set(key, value);
  }

  return { keysInOrder, values };
}

function resolveViewerLocaleFallbackValue(
  key: string,
  localeProps: ViewerProperties,
  fallbackProps: ViewerProperties,
): string | null {
  for (const alias of PDF_VIEWER_LOCALE_ALIASES[key] ?? []) {
    const aliased = localeProps.values.get(alias);
    if (aliased !== undefined) return aliased;
  }
  return fallbackProps.values.get(key) ?? null;
}

async function addDirectoryAssets(
  files: PublicAssetFile[],
  absoluteSrcDir: string,
  relativeDestDir: string,
): Promise<void> {
  const entries = await readdir(absoluteSrcDir, { withFileTypes: true });
  for (const entry of entries) {
    const absoluteSrc = join(absoluteSrcDir, entry.name);
    const relativeDest = join(relativeDestDir, entry.name);
    if (entry.isDirectory()) {
      await addDirectoryAssets(files, absoluteSrc, relativeDest);
    } else if (entry.isFile()) {
      addFileAsset(files, absoluteSrc, relativeDest);
    }
  }
}

async function addPdfViewerLocaleAssets(files: PublicAssetFile[]): Promise<void> {
  const localeDir = join(PDFJS_UPSTREAM_DIR, "web", "locale");
  try {
    await access(localeDir);
  } catch {
    return;
  }

  const legacyFallbackPath = join(localeDir, "en-US", "viewer.properties");
  try {
    await access(legacyFallbackPath);
  } catch {
    await addDirectoryAssets(files, localeDir, "pdf/web/locale");
    return;
  }

  const fallbackProps = parseViewerProperties(
    await readFile(legacyFallbackPath, "utf8"),
  );
  await addPatchedLocaleDirectoryAssets(
    files,
    localeDir,
    "pdf/web/locale",
    fallbackProps,
  );
}

async function addPatchedLocaleDirectoryAssets(
  files: PublicAssetFile[],
  absoluteSrcDir: string,
  relativeDestDir: string,
  fallbackProps: ViewerProperties,
): Promise<void> {
  const entries = await readdir(absoluteSrcDir, { withFileTypes: true });
  for (const entry of entries) {
    const absoluteSrc = join(absoluteSrcDir, entry.name);
    const relativeDest = join(relativeDestDir, entry.name);
    if (entry.isDirectory()) {
      await addPatchedLocaleDirectoryAssets(
        files,
        absoluteSrc,
        relativeDest,
        fallbackProps,
      );
      continue;
    }
    if (!entry.isFile()) continue;

    if (entry.name === "viewer.properties") {
      addTextAsset(
        files,
        patchPdfViewerLocaleContents(
          await readFile(absoluteSrc, "utf8"),
          fallbackProps,
        ),
        relativeDest,
      );
      continue;
    }

    addFileAsset(files, absoluteSrc, relativeDest);
  }
}

async function addPdfViewerPublicAssets(files: PublicAssetFile[]): Promise<void> {
  const release = JSON.parse(
    await readFile(join(PDFJS_UPSTREAM_DIR, "PDFJS_RELEASE.json"), "utf8"),
  ) as { version?: string };

  addFileAsset(files, join(PDFJS_UPSTREAM_DIR, "LICENSE"), "pdf/LICENSE");
  files.push({
    contents: `${release.version ?? "unknown"}\n`,
    relativeDest: "pdf/PDFJS_VERSION",
  });
  addFileAsset(
    files,
    join(PDFJS_UPSTREAM_DIR, "PDFJS_RELEASE.json"),
    "pdf/PDFJS_RELEASE.json",
  );

  await addPdfJsUpstreamAssets(files);
  await addPdfViewerLocaleAssets(files);
  await addDirectoryAssets(files, INTER_FONT_DIR, "pdf/web/fonts/inter");
}

async function addEpubViewerPublicAssets(files: PublicAssetFile[]): Promise<void> {
  await addDirectoryAssets(files, EPUB_VIEWER_ASSET_DIR, "epub/web");
}

async function addPdfJsUpstreamAssets(
  files: PublicAssetFile[],
  absoluteSrcDir = PDFJS_UPSTREAM_DIR,
  relativeSrcDir = "",
): Promise<void> {
  const entries = await readdir(absoluteSrcDir, { withFileTypes: true });
  for (const entry of entries) {
    const absoluteSrc = join(absoluteSrcDir, entry.name);
    const relativeSrc = join(relativeSrcDir, entry.name);
    if (entry.isDirectory()) {
      if (relativeSrc === join("web", "locale")) continue;
      await addPdfJsUpstreamAssets(files, absoluteSrc, relativeSrc);
      continue;
    }
    if (!entry.isFile() || entry.name.endsWith(".map")) continue;
    if (relativeSrc === "PDFJS_RELEASE.json" || relativeSrc === "LICENSE") continue;
    await addPdfJsUpstreamFileAsset(files, absoluteSrc, relativeSrc);
  }
}

async function addPdfJsUpstreamFileAsset(
  files: PublicAssetFile[],
  absoluteSrc: string,
  relativeSrc: string,
): Promise<void> {
  const relativeDest = join("pdf", relativeSrc);
  if (/^build[\\/]pdf\.(?:js|mjs)$/.test(relativeSrc)) {
    addTextAsset(
      files,
      patchPdfJsCanvasReadback(await readFile(absoluteSrc, "utf8")),
      relativeDest,
    );
    return;
  }
  if (relativeSrc === join("web", "viewer.html")) {
    addTextAsset(
      files,
      patchPdfViewerHtml(await readFile(absoluteSrc, "utf8")),
      relativeDest,
    );
    return;
  }
  if (/^web[\\/]viewer\.(?:js|mjs)$/.test(relativeSrc)) {
    addTextAsset(
      files,
      patchPdfViewerScript(await readFile(absoluteSrc, "utf8"), relativeSrc),
      relativeDest,
    );
    return;
  }
  addFileAsset(files, absoluteSrc, relativeDest);
}

function ensureCspDirectiveSource(
  csp: string | undefined,
  directive: string,
  origin: string,
): string {
  const parts = (csp ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  let foundDirective = false;

  for (let i = 0; i < parts.length; i++) {
    const tokens = parts[i]?.split(/\s+/).filter(Boolean) ?? [];
    if (tokens[0] !== directive) continue;
    foundDirective = true;
    if (!tokens.includes(origin)) tokens.push(origin);
    parts[i] = tokens.join(" ");
  }

  if (!foundDirective) parts.push(`${directive} 'self' ${origin}`);

  return `${parts.join("; ")};`;
}

function ensureExtensionPageCsp(csp: string | undefined, origin: string): string {
  let next = ensureCspDirectiveSource(csp, "script-src", origin);
  next = ensureCspDirectiveSource(next, "font-src", origin);
  if (!next.split(";").some((part) => part.trim().startsWith("object-src "))) {
    next = `${next.replace(/;\s*$/, "")}; object-src 'self';`;
  }

  return next;
}

type MutableManifest = {
  content_security_policy?:
    | string
    | {
        extension_pages?: string;
        sandbox?: string;
      };
  host_permissions?: string[];
  options_ui?: {
    open_in_tab?: boolean;
    page?: string;
  };
  permissions?: string[];
  web_accessible_resources?: string[] | WebAccessibleResourceEntry[];
};

type WebAccessibleResourceEntry = {
  matches?: string[];
  resources?: string[];
};

const DOCUMENT_VIEWER_WEB_ACCESSIBLE_RESOURCES = [
  "viewer.html",
  "chunks/*",
  "assets/*",
  "pdf/*",
  "pdf-viewer.js",
  "epub/*",
  "epub-viewer.js",
];

function withUnique(list: string[] | undefined, value: string): string[] {
  const next = list ?? [];
  return next.includes(value) ? next : [...next, value];
}

function without(list: string[] | undefined, value: string): string[] {
  return (list ?? []).filter((item) => item !== value);
}

function normalizeWebAccessibleResources(
  entries: MutableManifest["web_accessible_resources"],
): WebAccessibleResourceEntry[] {
  if (!entries) return [];
  if (entries.every((entry) => typeof entry === "string")) {
    return [{ resources: [...entries], matches: ["<all_urls>"] }];
  }
  return entries.filter(
    (entry): entry is WebAccessibleResourceEntry =>
      typeof entry === "object" && entry !== null,
  );
}

function ensureDocumentViewerManifestAccess(manifest: MutableManifest): void {
  manifest.permissions = without(manifest.permissions, "declarativeNetRequest");
  for (const permission of [
    "tabs",
    "webRequest",
    "declarativeNetRequestWithHostAccess",
  ]) {
    manifest.permissions = withUnique(manifest.permissions, permission);
  }

  manifest.host_permissions = withUnique(manifest.host_permissions, "<all_urls>");
  manifest.host_permissions = withUnique(manifest.host_permissions, "file://*/*");

  const resources = new Set(DOCUMENT_VIEWER_WEB_ACCESSIBLE_RESOURCES);
  const webAccessible = normalizeWebAccessibleResources(
    manifest.web_accessible_resources,
  );
  const existing = webAccessible.find((entry) =>
    entry.matches?.includes("<all_urls>"),
  );
  if (existing) {
    for (const resource of existing.resources ?? []) resources.add(resource);
    existing.resources = [...resources];
  } else {
    webAccessible.push({
      resources: [...resources],
      matches: ["<all_urls>"],
    });
  }
  manifest.web_accessible_resources = webAccessible;
}

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-solid"],
  manifest: {
    name: "OneLingo",
    description: "跨平台翻译拓展",
    permissions: [
      "storage",
      "unlimitedStorage",
      "contextMenus",
      "tabs",
      "webRequest",
      "declarativeNetRequestWithHostAccess",
    ],
    host_permissions: ["<all_urls>", "file://*/*"],
    web_accessible_resources: [
      {
        resources: DOCUMENT_VIEWER_WEB_ACCESSIBLE_RESOURCES,
        matches: ["<all_urls>"],
      },
    ],
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
    // dev 模式下 popup 脚本从 Vite HTTP server (localhost:3000) 加载。
    // WXT 本身会将 wxt.server.origin（Vite 实际绑定端口）追加到 CSP，
    // 但选择性重建时可能产生 manifest 与 popup.html 跨会话端口不一致。
    // 以此自定义 CSP 为基础，确保 3000 始终可用；WXT 会在其之上追加当次端口。
    // object-src 'self' 保留 MV3 默认行为。生产包的 localhost 条目无害。
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval' http://localhost:3000; object-src 'self';",
    },
  },
  hooks: {
    // WXT dev 模式会重写 CSP 并追加动态端口，这里兜底保留 3000，
    // 避免 popup.html（常驻 3000）与 manifest CSP 端口错位。
    "build:manifestGenerated": (_wxt, manifest) => {
      manifest.options_ui = {
        page: "options.html",
        open_in_tab: true,
      };
      ensureDocumentViewerManifestAccess(manifest);

      const csp = manifest.content_security_policy;
      if (!csp || typeof csp === "string") return;
      csp.extension_pages = ensureExtensionPageCsp(
        csp.extension_pages,
        "http://localhost:3000",
      );
      csp.sandbox = ensureExtensionPageCsp(csp.sandbox, "http://localhost:3000");
    },
    "prepare:publicPaths": (_wxt, paths) => {
      if (!paths.includes("pdf/web/viewer.html")) {
        paths.push("pdf/web/viewer.html");
      }
      if (!paths.includes("epub/web/viewer.html")) {
        paths.push("epub/web/viewer.html");
      }
    },
    "build:publicAssets": async (_wxt, files) => {
      await addPdfViewerPublicAssets(files);
      await addEpubViewerPublicAssets(files);
    },
  },
  webExt: {
    disabled: true,
  },
});
