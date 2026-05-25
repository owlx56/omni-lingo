import { defineConfig } from "wxt";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
const PDFJS_DIST_DIR = join(ROOT_DIR, "node_modules", "pdfjs-dist");
const PDF_VIEWER_ASSET_DIR = join(ROOT_DIR, "src", "assets", "pdf-viewer");
const INTER_FONT_DIR = join(ROOT_DIR, "src", "assets", "fonts", "inter");

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

async function addPdfViewerPublicAssets(files: PublicAssetFile[]): Promise<void> {
  const packageJson = JSON.parse(
    await readFile(join(PDFJS_DIST_DIR, "package.json"), "utf8"),
  ) as { version?: string };

  addFileAsset(files, join(PDFJS_DIST_DIR, "LICENSE"), "pdf/LICENSE");
  files.push({
    contents: `${packageJson.version ?? "unknown"}\n`,
    relativeDest: "pdf/PDFJS_VERSION",
  });

  for (const file of ["pdf.mjs", "pdf.worker.mjs", "pdf.sandbox.mjs"]) {
    addFileAsset(files, join(PDFJS_DIST_DIR, "build", file), `pdf/build/${file}`);
  }

  addFileAsset(
    files,
    join(PDFJS_DIST_DIR, "web", "pdf_viewer.mjs"),
    "pdf/web/pdf_viewer.mjs",
  );
  addFileAsset(
    files,
    join(PDFJS_DIST_DIR, "web", "pdf_viewer.css"),
    "pdf/web/pdf_viewer.css",
  );

  for (const dir of ["cmaps", "iccs", "standard_fonts", "wasm"]) {
    await addDirectoryAssets(
      files,
      join(PDFJS_DIST_DIR, dir),
      `pdf/web/${dir}`,
    );
  }
  await addDirectoryAssets(
    files,
    join(PDFJS_DIST_DIR, "web", "images"),
    "pdf/web/images",
  );
  await addDirectoryAssets(files, INTER_FONT_DIR, "pdf/web/fonts/inter");

  for (const file of [
    "viewer.html",
    "viewer.mjs",
    "viewer.css",
    "onelingo-viewer.css",
  ]) {
    addFileAsset(files, join(PDF_VIEWER_ASSET_DIR, file), `pdf/web/${file}`);
  }
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
  "pdf-bridge.js",
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
    },
    "build:publicAssets": async (_wxt, files) => {
      await addPdfViewerPublicAssets(files);
    },
  },
  webExt: {
    disabled: true,
  },
});
