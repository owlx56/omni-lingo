import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_PDFJS_VERSION = "3.3.122";
const PDFJS_LATEST_RELEASE_URL =
  "https://api.github.com/repos/mozilla/pdf.js/releases/latest";
const pdfJsReleaseUrl = (tag: string): string =>
  `https://api.github.com/repos/mozilla/pdf.js/releases/tags/${encodeURIComponent(
    tag,
  )}`;

const ROOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const PDF_VIEWER_DIR = join(ROOT_DIR, "src", "assets", "pdf-viewer");
const UPSTREAM_DIR = join(PDF_VIEWER_DIR, "upstream");
const RELEASE_META_FILE = "PDFJS_RELEASE.json";

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
  version: string;
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
  const release = await fetchPdfJsRelease(options);
  const asset = selectDistAsset(release);
  const downloadUrl = asset.browser_download_url;
  if (!downloadUrl) {
    throw new Error(`PDF.js asset ${asset.name ?? "(unknown)"} has no URL.`);
  }

  console.log(
    `Downloading PDF.js ${release.tag_name ?? options.version} from ${asset.name}.`,
  );
  const archive = Buffer.from(await downloadArrayBuffer(downloadUrl));
  const sha256 = createHash("sha256").update(archive).digest("hex");

  const tempRoot = await mkdtemp(join(tmpdir(), "onelingo-pdfjs-"));
  try {
    const archivePath = join(tempRoot, "pdfjs-dist.zip");
    const extractDir = join(tempRoot, "dist");
    await mkdir(extractDir, { recursive: true });
    await writeFile(archivePath, archive);
    await extractZip(archivePath, extractDir);

    await assertRequiredDistFiles(extractDir);
    await replaceUpstream(extractDir, {
      source: "github-release-dist",
      version: versionFromAsset(asset.name ?? "", release.tag_name ?? ""),
      tag: release.tag_name ?? normalizeReleaseTag(options.version),
      releaseName: release.name ?? release.tag_name ?? options.version,
      assetName: asset.name ?? "pdfjs-dist.zip",
      browserDownloadUrl: downloadUrl,
      sha256,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  console.log(`PDF.js upstream assets updated in ${relative(ROOT_DIR, UPSTREAM_DIR)}.`);
}

function parseArgs(args: string[]): CliOptions {
  let latest = false;
  let version = DEFAULT_PDFJS_VERSION;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
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

  return { latest, version };
}

async function fetchPdfJsRelease(options: CliOptions): Promise<GithubRelease> {
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

async function assertRequiredDistFiles(extractDir: string): Promise<void> {
  for (const file of ["web/viewer.html", "web/viewer.css"]) {
    if (!(await pathExists(join(extractDir, file)))) {
      throw new Error(`PDF.js dist is missing ${file}.`);
    }
  }

  if (
    !(await hasAnyPath(extractDir, ["web/viewer.js", "web/viewer.mjs"])) ||
    !(await hasAnyPath(extractDir, ["build/pdf.js", "build/pdf.mjs"])) ||
    !(await hasAnyPath(extractDir, ["build/pdf.worker.js", "build/pdf.worker.mjs"]))
  ) {
    throw new Error("PDF.js dist is missing required viewer/build files.");
  }
}

async function replaceUpstream(
  extractDir: string,
  metadata: ReleaseMetadata,
): Promise<void> {
  assertInside(ROOT_DIR, UPSTREAM_DIR);
  await rm(UPSTREAM_DIR, { recursive: true, force: true });
  await mkdir(UPSTREAM_DIR, { recursive: true });

  if (await pathExists(join(extractDir, "LICENSE"))) {
    await cp(join(extractDir, "LICENSE"), join(UPSTREAM_DIR, "LICENSE"));
  }

  await copyBuildFiles(extractDir);
  for (const file of webFileCandidates) {
    await copyIfExists(extractDir, file);
  }
  for (const dir of directoryCandidates) {
    await copyIfExists(extractDir, dir);
  }

  await writeFile(
    join(UPSTREAM_DIR, RELEASE_META_FILE),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
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

  const target = join(UPSTREAM_DIR, relativePath);
  assertInside(UPSTREAM_DIR, target);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
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
  if (relativePath.startsWith("..") || relativePath.startsWith("/") || /^[A-Za-z]:/.test(relativePath)) {
    throw new Error(`Refusing to write outside ${root}: ${target}`);
  }
}

function versionFromAsset(assetName: string, fallbackTag: string): string {
  const match = assetName.match(/^pdfjs-(.+?)-(?:legacy-)?dist\.zip$/i);
  return trimVersion(match?.[1] ?? fallbackTag);
}

function trimVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}
