import { stripDocumentExtension } from "./source";
import type { DocumentSource, ReaderDocument, ReaderSection } from "./types";
import { unzip } from "./zip";

type ManifestItem = {
  href: string;
  id: string;
  mediaType: string;
  path: string;
};

const XHTML_MEDIA_TYPES = new Set([
  "application/xhtml+xml",
  "text/html",
  "application/xml",
]);

const REMOVE_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "form",
  "input",
  "button",
  "textarea",
  "select",
]);

const ALLOWED_TAGS = new Set([
  "a",
  "abbr",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "dd",
  "del",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

export async function parseEpub(source: DocumentSource): Promise<ReaderDocument> {
  const files = await unzip(source.bytes);
  const containerXml = decodeFile(files, "META-INF/container.xml");
  const container = parseXml(containerXml);
  const rootfile = elementsByLocalName(container, "rootfile")[0];
  const opfPath = rootfile?.getAttribute("full-path");
  if (!opfPath) {
    throw new Error("EPUB container does not point to a package document");
  }

  const opf = parseXml(decodeFile(files, opfPath));
  const manifest = readManifest(opf, opfPath);
  const spine = elementsByLocalName(opf, "itemref")
    .map((item) => item.getAttribute("idref") ?? "")
    .map((idref) => manifest.get(idref))
    .filter((item): item is ManifestItem => !!item);
  const readingOrder =
    spine.length > 0
      ? spine
      : [...manifest.values()].filter((item) =>
          XHTML_MEDIA_TYPES.has(item.mediaType),
        );
  const title =
    elementsByLocalName(opf, "title")[0]?.textContent?.trim() ||
    stripDocumentExtension(source.name);
  const objectUrls: string[] = [];

  const sections: ReaderSection[] = readingOrder.map((item, index) => {
    const html = decodeFile(files, item.path);
    return {
      html: sanitizeHtml(html, item.path, files, objectUrls),
      id: `epub-section-${index}`,
      title: sectionTitleFromPath(item.href, index),
    };
  });

  return {
    cleanup: () => objectUrls.forEach((url) => URL.revokeObjectURL(url)),
    kind: "foliate",
    sections,
    sourceName: source.name,
    title,
    warnings: [],
  };
}

function readManifest(opf: Document, opfPath: string): Map<string, ManifestItem> {
  const base = dirname(opfPath);
  const manifest = new Map<string, ManifestItem>();
  for (const item of elementsByLocalName(opf, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (!id || !href) continue;
    manifest.set(id, {
      href,
      id,
      mediaType: item.getAttribute("media-type") ?? "",
      path: resolveZipPath(base, href),
    });
  }
  return manifest;
}

function sanitizeHtml(
  rawHtml: string,
  filePath: string,
  files: Map<string, Uint8Array>,
  objectUrls: string[],
): string {
  const parsed = new DOMParser().parseFromString(rawHtml, "text/html");
  const base = dirname(filePath);
  sanitizeChildren(parsed.body, base, files, objectUrls);
  return parsed.body.innerHTML;
}

function sanitizeChildren(
  parent: ParentNode,
  base: string,
  files: Map<string, Uint8Array>,
  objectUrls: string[],
): void {
  for (const child of [...parent.childNodes]) {
    if (!(child instanceof Element)) continue;
    const tag = child.localName.toLowerCase();
    if (REMOVE_TAGS.has(tag)) {
      child.remove();
      continue;
    }
    sanitizeChildren(child, base, files, objectUrls);
    if (!ALLOWED_TAGS.has(tag)) {
      unwrap(child);
      continue;
    }
    sanitizeAttributes(child, base, files, objectUrls);
  }
}

function sanitizeAttributes(
  el: Element,
  base: string,
  files: Map<string, Uint8Array>,
  objectUrls: string[],
): void {
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on") || name === "style" || name === "srcset") {
      el.removeAttribute(attr.name);
      continue;
    }
    if (el.localName === "img" && name === "src") continue;
    if (el.localName === "a" && name === "href") continue;
    if (
      name !== "alt" &&
      name !== "title" &&
      name !== "lang" &&
      name !== "dir" &&
      name !== "colspan" &&
      name !== "rowspan"
    ) {
      el.removeAttribute(attr.name);
    }
  }

  if (el.localName === "img") {
    const src = el.getAttribute("src");
    const assetPath = src ? resolveZipPath(base, src) : null;
    const asset = assetPath ? files.get(assetPath) : undefined;
    if (!asset || !assetPath) {
      el.removeAttribute("src");
      return;
    }
    const url = URL.createObjectURL(
      new Blob([copyArrayBuffer(asset)], { type: mimeFromPath(assetPath) }),
    );
    objectUrls.push(url);
    el.setAttribute("src", url);
    el.setAttribute("loading", "lazy");
  }

  if (el.localName === "a") {
    const href = el.getAttribute("href") ?? "";
    if (href.startsWith("#")) return;
    el.removeAttribute("href");
  }
}

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  el.remove();
}

function decodeFile(files: Map<string, Uint8Array>, path: string): string {
  const file = files.get(path);
  if (!file) throw new Error(`Missing EPUB file: ${path}`);
  return new TextDecoder("utf-8").decode(file);
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid EPUB XML");
  }
  return doc;
}

function elementsByLocalName(root: ParentNode, name: string): Element[] {
  return [...root.querySelectorAll("*")].filter((el) => el.localName === name);
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}

function resolveZipPath(base: string, href: string): string {
  const cleanHref = href.split("#")[0]?.split("?")[0] ?? "";
  const parts = `${base}/${decodeURIComponent(cleanHref)}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function sectionTitleFromPath(href: string, index: number): string {
  const clean = href.split("#")[0]?.split("?")[0] ?? href;
  const last = clean.split("/").filter(Boolean).pop();
  return last ? decodeURIComponent(last).replace(/\.[a-z0-9]+$/i, "") : `Part ${index + 1}`;
}

function mimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function copyArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}
