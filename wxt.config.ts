import { defineConfig } from "wxt";
import { access, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import "./scripts/generate-i18n";

const PDFJS_PACKAGE_NAME = "@onelingo/pdfjs-dist";

type PublicAssetFile =
  | {
      absoluteSrc: string;
      relativeDest: string;
    }
  | {
      contents: string;
      relativeDest: string;
    };

type PdfJsDistPackage = {
  packageDir: string;
  distDir: string;
};

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PDFJS_DIST_PACKAGE = resolvePdfJsDistPackage();
const PDFJS_DIST_PACKAGE_DIR = PDFJS_DIST_PACKAGE.packageDir;
const PDFJS_DIST_DIR = PDFJS_DIST_PACKAGE.distDir;
const FOLIATE_JS_PACKAGE_DIR = join(ROOT_DIR, "node_modules", "foliate-js");
const PDFJS_RELEASE_LOCK_PATH = join(
  PDFJS_DIST_PACKAGE_DIR,
  "pdfjs-release.lock.json",
);
const PDFJS_RELEASE_META_PATH = join(PDFJS_DIST_DIR, "PDFJS_RELEASE.json");
const EPUB_VIEWER_ASSET_DIR = join(ROOT_DIR, "src", "assets", "epub-viewer");
const INTER_FONT_DIR = join(ROOT_DIR, "src", "assets", "fonts", "inter");
const FOLIATE_JS_PUBLIC_DIR = "epub/web/foliate-js";
const FOLIATE_JS_RUNTIME_FILES = [
  "comic-book.js",
  "epub.js",
  "epubcfi.js",
  "fb2.js",
  "fixed-layout.js",
  "mobi.js",
  "overlayer.js",
  "pdf.js",
  "paginator.js",
  "progress.js",
  "search.js",
  "text-walker.js",
  "tts.js",
  "view.js",
  "vendor/fflate.js",
  "vendor/zip.js",
  "vendor/pdfjs/annotation_layer_builder.css",
  "vendor/pdfjs/pdf.mjs",
  "vendor/pdfjs/pdf.worker.mjs",
  "vendor/pdfjs/text_layer_builder.css",
];
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

type PdfJsReleaseMetadata = {
  source: "github-release-dist";
  version: string;
  tag: string;
  releaseName: string;
  assetName: string;
  browserDownloadUrl: string;
  sha256: string;
};

function tryResolvePdfJsPath(path: string): string | null {
  try {
    return require.resolve(path);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (
      code === "MODULE_NOT_FOUND" ||
      String(error).includes("Cannot find module")
    ) {
      return null;
    }
    throw error;
  }
}

function resolvePdfJsDistPackage(): PdfJsDistPackage {
  const packageJsonPath = tryResolvePdfJsPath(`${PDFJS_PACKAGE_NAME}/package.json`);

  const packageDistBuildPath =
    tryResolvePdfJsPath(`${PDFJS_PACKAGE_NAME}/dist/build/pdf.mjs`) ??
    tryResolvePdfJsPath(`${PDFJS_PACKAGE_NAME}/dist/build/pdf.js`);
  if (packageJsonPath && packageDistBuildPath) {
    return {
      packageDir: dirname(packageJsonPath),
      distDir: dirname(dirname(packageDistBuildPath)),
    };
  }

  throw new Error(
    `Unable to locate PDF.js dist assets in ${PDFJS_PACKAGE_NAME}. ` +
      "Expected package shell layout with dist/build/pdf.mjs.",
  );
}

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

function patchFoliatePaginatorScript(contents: string): string {
  let next = contents;

  const goToNeedle =
    "    async #goTo({ index, anchor, select}) {\n" +
    "        if (index === this.#index) await this.#display({ index, anchor, select })\n";
  if (next.includes(goToNeedle)) {
    next = next.replace(
      goToNeedle,
      "    async #goTo({ index, anchor, select}) {\n" +
        "        if (index == null || !this.sections[index]) return\n" +
        "        if (index === this.#index) await this.#display({ index, anchor, select })\n",
    );
  }

  const publicGoToNeedle =
    "    async goTo(target) {\n" +
    "        if (this.#locked) return\n" +
    "        const resolved = await target\n" +
    "        if (this.#canGoToIndex(resolved.index)) return this.#goTo(resolved)\n" +
    "    }";
  if (next.includes(publicGoToNeedle)) {
    next = next.replace(
      publicGoToNeedle,
      "    async goTo(target) {\n" +
        "        if (this.#locked) return\n" +
        "        const resolved = await target\n" +
        "        if (!resolved || !this.#canGoToIndex(resolved.index)) return\n" +
        "        return this.#goTo(resolved)\n" +
        "    }",
    );
  }

  const turnPageNeedle =
    "    async #turnPage(dir, distance) {\n" +
    "        if (this.#locked) return\n" +
    "        this.#locked = true\n" +
    "        const prev = dir === -1\n" +
    "        const shouldGo = await (prev ? this.#scrollPrev(distance) : this.#scrollNext(distance))\n" +
    "        if (shouldGo) await this.#goTo({\n" +
    "            index: this.#adjacentIndex(dir),\n" +
    "            anchor: prev ? () => 1 : () => 0,\n" +
    "        })\n" +
    "        if (shouldGo || !this.hasAttribute('animated')) await wait(100)\n" +
    "        this.#locked = false\n" +
    "    }";
  if (next.includes(turnPageNeedle)) {
    next = next.replace(
      turnPageNeedle,
      "    async #turnPage(dir, distance) {\n" +
        "        if (this.#locked) return\n" +
        "        this.#locked = true\n" +
        "        try {\n" +
        "            const prev = dir === -1\n" +
        "            const shouldGo = await (prev ? this.#scrollPrev(distance) : this.#scrollNext(distance))\n" +
        "            if (shouldGo) {\n" +
        "                const index = this.#adjacentIndex(dir)\n" +
        "                if (index == null) return\n" +
        "                await this.#goTo({\n" +
        "                    index,\n" +
        "                    anchor: prev ? () => 1 : () => 0,\n" +
        "                })\n" +
        "            }\n" +
        "            if (shouldGo || !this.hasAttribute('animated')) await wait(100)\n" +
        "        } finally {\n" +
        "            this.#locked = false\n" +
        "        }\n" +
        "    }",
    );
  }

  if (!next.includes("if (index == null || !this.sections[index]) return")) {
    throw new Error("Unable to patch Foliate paginator navigation guards.");
  }
  return next;
}

function patchFoliateIframeSandbox(contents: string): string {
  const replacement =
    "        this.#iframe.setAttribute('sandbox',\n" +
    "            /AppleWebKit/.test(navigator.userAgent) &&\n" +
    "            !/(Chrome|Chromium|Edg|OPR)/.test(navigator.userAgent)\n" +
    "                ? 'allow-same-origin allow-scripts'\n" +
    "                : 'allow-same-origin')";
  const paginatorNeedle =
    "        this.#iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')";
  const fixedLayoutNeedle =
    "        iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')";

  let next = contents;
  if (next.includes(paginatorNeedle)) {
    next = next.replace(paginatorNeedle, replacement);
  }
  if (next.includes(fixedLayoutNeedle)) {
    next = next.replace(fixedLayoutNeedle, replacement.replace("this.#iframe", "iframe"));
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
  const localeDir = join(PDFJS_DIST_DIR, "web", "locale");
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
  const release = await readPdfJsReleaseMetadata();

  addFileAsset(files, join(PDFJS_DIST_DIR, "LICENSE"), "pdf/LICENSE");
  files.push({
    contents: `${release.version}\n`,
    relativeDest: "pdf/PDFJS_VERSION",
  });
  addTextAsset(
    files,
    `${JSON.stringify(release, null, 2)}\n`,
    "pdf/PDFJS_RELEASE.json",
  );

  await addPdfJsUpstreamAssets(files);
  await addPdfViewerLocaleAssets(files);
  await addDirectoryAssets(files, INTER_FONT_DIR, "pdf/web/fonts/inter");
}

async function readPdfJsReleaseMetadata(): Promise<PdfJsReleaseMetadata> {
  const release = await readPdfJsReleaseMetadataFile(PDFJS_RELEASE_META_PATH);
  await assertPdfJsUpstreamMatchesLock(release);
  return release;
}

async function assertPdfJsUpstreamMatchesLock(
  release: PdfJsReleaseMetadata,
): Promise<void> {
  const lock = await readPdfJsReleaseMetadataFile(PDFJS_RELEASE_LOCK_PATH);
  const mismatchedField = (
    [
      "source",
      "version",
      "tag",
      "releaseName",
      "assetName",
      "browserDownloadUrl",
      "sha256",
    ] as const
  ).find((field) => release[field] !== lock[field]);
  if (!mismatchedField) return;

  throw new Error(
    `PDF.js dist package metadata mismatch (${mismatchedField}). Update @onelingo/pdfjs-dist.`,
  );
}

async function readPdfJsReleaseMetadataFile(
  path: string,
): Promise<PdfJsReleaseMetadata> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(
        `Missing PDF.js assets at ${path}. Check @onelingo/pdfjs-dist installation.`,
      );
    }
    throw error;
  }

  const parsed = JSON.parse(contents) as Partial<PdfJsReleaseMetadata>;
  const requiredFields = [
    "source",
    "version",
  ] as const;
  for (const field of requiredFields) {
    if (typeof parsed[field] !== "string" || !parsed[field]) {
      throw new Error(
        `${path} is missing ${field}. Check @onelingo/pdfjs-dist installation.`,
      );
    }
  }
  if (parsed.source !== "github-release-dist") {
    throw new Error(`${path} has unsupported PDF.js source ${parsed.source}.`);
  }

  const requiredReleaseFields = [
    "tag",
    "releaseName",
    "assetName",
    "browserDownloadUrl",
    "sha256",
  ] as const;
  for (const field of requiredReleaseFields) {
    if (typeof parsed[field] !== "string" || !parsed[field]) {
      throw new Error(
        `${path} is missing ${field}. Check @onelingo/pdfjs-dist installation.`,
      );
    }
  }
  return parsed as PdfJsReleaseMetadata;
}

async function addEpubViewerPublicAssets(files: PublicAssetFile[]): Promise<void> {
  await addDirectoryAssets(files, EPUB_VIEWER_ASSET_DIR, "epub/web");
}

async function addFoliateJsPublicAssets(files: PublicAssetFile[]): Promise<void> {
  for (const relativePath of FOLIATE_JS_RUNTIME_FILES) {
    const absoluteSrc = join(FOLIATE_JS_PACKAGE_DIR, relativePath);
    if (relativePath === "paginator.js") {
      addTextAsset(
        files,
        patchFoliateIframeSandbox(
          patchFoliatePaginatorScript(await readFile(absoluteSrc, "utf8")),
        ),
        join(FOLIATE_JS_PUBLIC_DIR, relativePath),
      );
      continue;
    }
    if (relativePath === "fixed-layout.js") {
      addTextAsset(
        files,
        patchFoliateIframeSandbox(await readFile(absoluteSrc, "utf8")),
        join(FOLIATE_JS_PUBLIC_DIR, relativePath),
      );
      continue;
    }
    addFileAsset(
      files,
      absoluteSrc,
      join(FOLIATE_JS_PUBLIC_DIR, relativePath),
    );
  }
  await addDirectoryAssets(
    files,
    join(FOLIATE_JS_PACKAGE_DIR, "vendor", "pdfjs", "cmaps"),
    join(FOLIATE_JS_PUBLIC_DIR, "vendor", "pdfjs", "cmaps"),
  );
  await addDirectoryAssets(
    files,
    join(FOLIATE_JS_PACKAGE_DIR, "vendor", "pdfjs", "standard_fonts"),
    join(FOLIATE_JS_PUBLIC_DIR, "vendor", "pdfjs", "standard_fonts"),
  );
}

async function addPdfJsUpstreamAssets(
  files: PublicAssetFile[],
  absoluteSrcDir = PDFJS_DIST_DIR,
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
    if (entry.name.startsWith(".")) continue;
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
      if (!paths.includes("epub/web/foliate-js/view.js")) {
        paths.push("epub/web/foliate-js/view.js");
      }
    },
    "build:publicAssets": async (_wxt, files) => {
      await addPdfViewerPublicAssets(files);
      await addEpubViewerPublicAssets(files);
      await addFoliateJsPublicAssets(files);
    },
  },
  webExt: {
    disabled: true,
  },
});
