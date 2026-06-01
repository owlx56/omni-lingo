export type FoliateFlow = "paginated" | "scrolled";

export interface FoliateTocItem {
  href: string;
  label: string;
  subitems: FoliateTocItem[];
}

export interface FoliateContent {
  doc: Document;
  index: number;
  overlayer?: unknown;
}

export interface FoliateRelocateDetail {
  fraction?: number;
  index?: number;
  location?: {
    current?: number;
    next?: number;
    total?: number;
  };
  pageItem?: {
    label?: string;
  };
  range?: Range;
  reason?: string;
  section?: {
    current?: number;
    total?: number;
  };
  size?: number;
  tocItem?: {
    href?: string;
    label?: string;
    subitems?: FoliateTocItem[];
  };
}

export interface FoliateLoadDetail {
  doc: Document;
  index: number;
}

export interface FoliateViewRenderer {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  getContents(): FoliateContent[];
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
  setStyles?(styles: string | [string, string]): void;
}

export interface FoliateBookLike {
  dir?: "ltr" | "rtl";
  metadata?: {
    author?: string | Record<string, string> | Array<string | Record<string, string>>;
    language?: string | string[];
    title?: string | Record<string, string>;
  };
  pageList?: unknown[];
  rendition?: {
    layout?: string;
  };
  resolveCFI?: (cfi: string) => {
    anchor: (doc: Document) => Element | Range | null;
    index: number;
  };
  resolveHref?: (href: string) => {
    anchor: (doc: Document) => Element | Range | null;
    index: number;
  };
  sections: Array<{
    id?: unknown;
    linear?: string;
    load?: () => Promise<string> | string;
    size?: number;
    unload?: () => void;
  }>;
  splitTOCHref?: (
    href: string,
  ) => Promise<[unknown, unknown]> | [unknown, unknown];
  toc?: unknown[];
  transformTarget?: EventTarget;
}

export interface FoliateViewElement extends HTMLElement {
  book?: FoliateBookLike;
  flow?: FoliateFlow;
  getContents(): FoliateContent[];
  goLeft(): Promise<void>;
  goRight(): Promise<void>;
  goTo(target: unknown): Promise<void>;
  goToTextStart?(): Promise<void>;
  next(distance?: number): Promise<void>;
  open(input: File | Blob | string | FoliateBookLike): Promise<void>;
  prev(distance?: number): Promise<void>;
  renderer?: FoliateViewRenderer | null;
}
