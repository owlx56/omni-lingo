import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_PDFJS_VERSION = "5.7.284";
const PDFJS_LATEST_RELEASE_URL =
  "https://api.github.com/repos/mozilla/pdf.js/releases/latest";
const pdfJsReleaseUrl = (tag: string): string =>
  `https://api.github.com/repos/mozilla/pdf.js/releases/tags/${encodeURIComponent(
    tag,
  )}`;

const ROOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const PDFJS_DIST_PACKAGE_DIR = join(ROOT_DIR, "vendor", "pdfjs-dist");
const PDFJS_DIST_DIR = join(PDFJS_DIST_PACKAGE_DIR, "dist");
const PDFJS_DIST_PACKAGE_JSON_PATH = join(PDFJS_DIST_PACKAGE_DIR, "package.json");
const RELEASE_LOCK_FILE = "pdfjs-release.lock.json";
const RELEASE_META_FILE = "PDFJS_RELEASE.json";
const RELEASE_LOCK_PATH = join(PDFJS_DIST_PACKAGE_DIR, RELEASE_LOCK_FILE);
const RELEASE_META_PATH = join(PDFJS_DIST_DIR, RELEASE_META_FILE);

type GithubReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type GithubRelease = {
  name?: string;
  tag_name?: string;
  assets?: GithubReleaseAsset[];
};

type ReleaseMetadata = {
  source: "github-release-dist";
  version: string;
  tag: string;
  releaseName: string;
  assetName: string;
  browserDownloadUrl: string;
  sha256: string;
};

type CliOptions = {
  latest: boolean;
  mode: "ensure" | "update";
  version?: string;
};

const webFileCandidates = [
  "web/debugger.css",
  "web/debugger.js",
  "web/debugger.mjs",
  "web/viewer.css",
  "web/viewer.html",
  "web/viewer.js",
  "web/viewer.mjs",
];

const directoryCandidates = [
  "image_decoders",
  "web/cmaps",
  "web/iccs",
  "web/images",
  "web/locale",
  "web/standard_fonts",
  "web/wasm",
];

await main();

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.mode === "ensure") {
    await ensurePdfJsUpstream();
    return;
  }

  await updatePdfJsUpstream(options);
}

async function ensurePdfJsUpstream(): Promise<void> {
  const lock = await readReleaseMetadata(
    RELEASE_LOCK_PATH,
    `PDF.js lock file ${relative(ROOT_DIR, RELEASE_LOCK_PATH)}`,
  );
  if (await isUpstreamCurrent(lock)) {
    console.log(`PDF.js ${lock.version} dist assets are ready.`);
    return;
  }

  console.log(`Restoring PDF.js ${lock.version} from ${RELEASE_LOCK_FILE}.`);
  await downloadAndReplaceUpstream(lock);
  console.log(
    `PDF.js dist assets restored in ${relative(ROOT_DIR, PDFJS_DIST_DIR)}.`,
  );
}

async function updatePdfJsUpstream(options: CliOptions): Promise<void> {
  const requestedVersion =
    options.version ??
    (await readReleaseMetadataIfExists(RELEASE_LOCK_PATH))?.version ??
    DEFAULT_PDFJS_VERSION;
  const release = await fetchPdfJsRelease({
    latest: options.latest,
    version: requestedVersion,
  });
  const asset = selectDistAsset(release);
  const downloadUrl = asset.browser_download_url;
  if (!downloadUrl) {
    throw new Error(`PDF.js asset ${asset.name ?? "(unknown)"} has no URL.`);
  }

  const label = release.tag_name ?? requestedVersion;
  console.log(`Downloading PDF.js ${label} from ${asset.name}.`);
  const { sha256 } = await downloadAndReplaceUpstream({
    source: "github-release-dist",
    version: versionFromAsset(asset.name ?? "", release.tag_name ?? ""),
    tag: release.tag_name ?? normalizeReleaseTag(requestedVersion),
    releaseName: release.name ?? release.tag_name ?? requestedVersion,
    assetName: asset.name ?? "pdfjs-dist.zip",
    browserDownloadUrl: downloadUrl,
    sha256: "",
  });

  const metadata: ReleaseMetadata = {
    source: "github-release-dist",
    version: versionFromAsset(asset.name ?? "", release.tag_name ?? ""),
    tag: release.tag_name ?? normalizeReleaseTag(requestedVersion),
    releaseName: release.name ?? release.tag_name ?? requestedVersion,
    assetName: asset.name ?? "pdfjs-dist.zip",
    browserDownloadUrl: downloadUrl,
    sha256,
  };
  await writeReleaseMetadata(RELEASE_LOCK_PATH, metadata);
  await writeReleaseMetadata(RELEASE_META_PATH, metadata);
  await writePdfJsDistPackageVersion(metadata.version);
  console.log(
    `PDF.js dist assets updated in ${relative(ROOT_DIR, PDFJS_DIST_DIR)}.`,
  );
  console.log(`PDF.js release lock updated at ${relative(ROOT_DIR, RELEASE_LOCK_PATH)}.`);
}

function parseArgs(args: string[]): CliOptions {
  let latest = false;
  let mode: CliOptions["mode"] = "update";
  let version: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--ensure") {
      mode = "ensure";
      continue;
    }
    if (arg === "--latest") {
      latest = true;
      continue;
    }
    if (arg === "--version") {
      const next = args[index + 1];
      if (!next) throw new Error("--version requires a value.");
      version = next;
      index++;
      continue;
    }
    if (arg?.startsWith("--version=")) {
      version = arg.slice("--version=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (mode === "ensure" && (latest || version)) {
    throw new Error("--ensure cannot be combined with --latest or --version.");
  }
  if (latest && version) {
    throw new Error("--latest cannot be combined with --version.");
  }

  return { latest, mode, version };
}

async function fetchPdfJsRelease(options: {
  latest: boolean;
  version: string;
}): Promise<GithubRelease> {
  const url = options.latest
    ? PDFJS_LATEST_RELEASE_URL
    : pdfJsReleaseUrl(normalizeReleaseTag(options.version));
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "onelingo-pdfjs-updater",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch PDF.js release: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as GithubRelease;
}

function normalizeReleaseTag(version: string): string {
  return version.toLowerCase().startsWith("v") ? version : `v${version}`;
}

function selectDistAsset(release: GithubRelease): GithubReleaseAsset {
  const assets = release.assets ?? [];
  const asset = assets.find(
    (item) =>
      typeof item.name === "string" &&
      /^pdfjs-.+-dist\.zip$/i.test(item.name) &&
      !/-legacy-dist\.zip$/i.test(item.name),
  );
  if (!asset) {
    throw new Error(
      `Could not find non-legacy pdfjs-*-dist.zip in ${
        release.tag_name ?? release.name ?? "release"
      }.`,
    );
  }
  return asset;
}

async function downloadAndReplaceUpstream(
  metadata: ReleaseMetadata,
): Promise<{ sha256: string }> {
  const archive = Buffer.from(await downloadArrayBuffer(metadata.browserDownloadUrl));
  const sha256 = createHash("sha256").update(archive).digest("hex");
  if (metadata.sha256 && metadata.sha256 !== sha256) {
    throw new Error(
      `PDF.js archive sha256 mismatch for ${metadata.assetName}: expected ${metadata.sha256}, got ${sha256}.`,
    );
  }

  const nextMetadata = { ...metadata, sha256 };
  const tempRoot = await mkdtemp(join(tmpdir(), "onelingo-pdfjs-"));
  try {
    const archivePath = join(tempRoot, "pdfjs-dist.zip");
    const extractDir = join(tempRoot, "dist");
    await mkdir(extractDir, { recursive: true });
    await writeFile(archivePath, archive);
    await extractZip(archivePath, extractDir);

    await assertRequiredDistFiles(extractDir);
    await replaceUpstream(extractDir, nextMetadata);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  return { sha256 };
}

async function downloadArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "onelingo-pdfjs-updater",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download PDF.js dist zip: ${response.status} ${response.statusText}`,
    );
  }
  return response.arrayBuffer();
}

async function extractZip(archivePath: string, targetDir: string): Promise<void> {
  await execFileAsync("tar", ["-xf", archivePath, "-C", targetDir]);
}

async function assertRequiredDistFiles(root: string): Promise<void> {
  for (const file of ["web/viewer.html", "web/viewer.css"]) {
    if (!(await pathExists(join(root, file)))) {
      throw new Error(`PDF.js dist is missing ${file}.`);
    }
  }

  if (
    !(await hasAnyPath(root, ["web/viewer.js", "web/viewer.mjs"])) ||
    !(await hasAnyPath(root, ["build/pdf.js", "build/pdf.mjs"])) ||
    !(await hasAnyPath(root, ["build/pdf.worker.js", "build/pdf.worker.mjs"]))
  ) {
    throw new Error("PDF.js dist is missing required viewer/build files.");
  }
}

async function replaceUpstream(
  extractDir: string,
  metadata: ReleaseMetadata,
): Promise<void> {
  assertInside(ROOT_DIR, PDFJS_DIST_DIR);
  await rm(PDFJS_DIST_DIR, { recursive: true, force: true });
  await mkdir(PDFJS_DIST_DIR, { recursive: true });

  if (await pathExists(join(extractDir, "LICENSE"))) {
    await cp(join(extractDir, "LICENSE"), join(PDFJS_DIST_DIR, "LICENSE"));
  }

  await copyBuildFiles(extractDir);
  for (const file of webFileCandidates) {
    await copyIfExists(extractDir, file);
  }
  for (const dir of directoryCandidates) {
    await copyIfExists(extractDir, dir);
  }

  await writeReleaseMetadata(RELEASE_META_PATH, metadata);
}

async function copyBuildFiles(extractDir: string): Promise<void> {
  const buildDir = join(extractDir, "build");
  const entries = await readdir(buildDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.endsWith(".map")) continue;
    await copyIfExists(extractDir, join("build", entry.name));
  }
}

async function copyIfExists(extractDir: string, relativePath: string): Promise<void> {
  const source = join(extractDir, relativePath);
  if (!(await pathExists(source))) return;

  const target = join(PDFJS_DIST_DIR, relativePath);
  assertInside(PDFJS_DIST_DIR, target);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}

async function isUpstreamCurrent(lock: ReleaseMetadata): Promise<boolean> {
  const metadata = await readReleaseMetadataIfExists(RELEASE_META_PATH);
  if (!metadata || !releaseMetadataMatches(metadata, lock)) return false;

  try {
    await assertRequiredDistFiles(PDFJS_DIST_DIR);
    return true;
  } catch {
    return false;
  }
}

async function writePdfJsDistPackageVersion(version: string): Promise<void> {
  const parsed = JSON.parse(
    await readFile(PDFJS_DIST_PACKAGE_JSON_PATH, "utf8"),
  ) as Record<string, unknown>;
  parsed.version = version;
  await writeFile(
    PDFJS_DIST_PACKAGE_JSON_PATH,
    `${JSON.stringify(parsed, null, 2)}\n`,
    "utf8",
  );
}

function releaseMetadataMatches(
  actual: ReleaseMetadata,
  expected: ReleaseMetadata,
): boolean {
  return (
    actual.source === expected.source &&
    actual.version === expected.version &&
    actual.tag === expected.tag &&
    actual.releaseName === expected.releaseName &&
    actual.assetName === expected.assetName &&
    actual.browserDownloadUrl === expected.browserDownloadUrl &&
    actual.sha256 === expected.sha256
  );
}

async function readReleaseMetadataIfExists(
  path: string,
): Promise<ReleaseMetadata | null> {
  try {
    return await readReleaseMetadata(path, path);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    return null;
  }
}

async function readReleaseMetadata(
  path: string,
  label: string,
): Promise<ReleaseMetadata> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<ReleaseMetadata>;
  return assertReleaseMetadata(parsed, label);
}

function assertReleaseMetadata(
  input: Partial<ReleaseMetadata>,
  label: string,
): ReleaseMetadata {
  const requiredFields: Array<keyof ReleaseMetadata> = [
    "source",
    "version",
    "tag",
    "releaseName",
    "assetName",
    "browserDownloadUrl",
    "sha256",
  ];

  for (const field of requiredFields) {
    if (typeof input[field] !== "string" || !input[field]) {
      throw new Error(`${label} is missing ${field}.`);
    }
  }
  if (input.source !== "github-release-dist") {
    throw new Error(`${label} has unsupported source ${input.source}.`);
  }

  return input as ReleaseMetadata;
}

async function writeReleaseMetadata(
  path: string,
  metadata: ReleaseMetadata,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

async function hasAnyPath(root: string, paths: string[]): Promise<boolean> {
  for (const path of paths) {
    if (await pathExists(join(root, path))) return true;
  }
  return false;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function assertInside(root: string, target: string): void {
  const relativePath = relative(resolve(root), resolve(target));
  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  ) {
    return;
  }
  throw new Error(`Refusing to write outside ${root}: ${target}`);
}

function versionFromAsset(assetName: string, fallbackTag: string): string {
  const match = assetName.match(/^pdfjs-(.+?)-(?:legacy-)?dist\.zip$/i);
  return trimVersion(match?.[1] ?? fallbackTag);
}

function trimVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}
