export type FoliateFlow = "paginated" | "scrolled";

export interface FoliateTocItem {
  id?: number | string;
  href: string;
  label: string;
  index?: number;
  location?: {
    current?: number;
    next?: number;
    total?: number;
  };
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
    index?: number;
    location?: {
      current?: number;
      next?: number;
      total?: number;
    };
    subitems?: FoliateTocItem[];
  };
}

export interface FoliateLoadDetail {
  doc: Document;
  index: number;
}

export interface FoliateLinkDetail {
  a: HTMLAnchorElement;
  href: string;
  check?: boolean;
  follow?: boolean;
}

export type FoliateLinkEvent = CustomEvent<FoliateLinkDetail>;

export type FoliateLanguageMap = string | Record<string, string>;

export type FoliateContributorValue =
  | string
  | Record<string, string>
  | Array<string | Record<string, string>>;

export interface FoliateSeriesValue {
  name?: FoliateLanguageMap;
  position?: number | string;
  [key: string]: unknown;
}

export interface FoliateBookMetadata {
  author?: FoliateContributorValue;
  belongsTo?: {
    collection?: FoliateSeriesValue | FoliateSeriesValue[];
    series?: FoliateSeriesValue | FoliateSeriesValue[];
  };
  description?: string | Record<string, string>;
  identifier?: string | string[];
  language?: string | string[];
  modified?: string | Date;
  published?: string | Date;
  publisher?: FoliateContributorValue;
  rights?: string | Record<string, string>;
  subject?: FoliateContributorValue;
  subtitle?: FoliateLanguageMap;
  title?: FoliateLanguageMap;
  [key: string]: unknown;
}

export interface FoliateViewRenderer {
  primaryIndex?: number;
  shadowRoot?: ShadowRoot | null;
  viewSize?: number;
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
  render?(): void;
  setAttribute(name: string, value: string): void;
  nextSection?(): Promise<void> | void;
  prevSection?(): Promise<void> | void;
  setStyles?(styles: string | [string, string]): void;
}

export interface FoliateBookLike {
  dir?: "ltr" | "rtl";
  getCover?: () => Promise<Blob | null> | Blob | null;
  metadata?: FoliateBookMetadata;
  pageList?: unknown[];
  rendition?: {
    layout?: string;
  };
  resolveCFI?: (cfi: string) => {
    anchor: (doc: Document) => Element | Range | null;
    index: number;
  };
  resolveHref?: (href: string) =>
    | {
        anchor?: (doc: Document) => Element | Range | null;
        index: number;
      }
    | null
    | undefined
    | Promise<
        | {
            anchor?: (doc: Document) => Element | Range | null;
            index: number;
          }
        | null
        | undefined
      >;
  sections: Array<{
    createDocument?: () => Promise<Document> | Document;
    id?: unknown;
    linear?: string;
    load?: () => Promise<string> | string;
    size?: number;
    unload?: () => void;
  }>;
  getTOCFragment?: (doc: Document, id: unknown) => Node | Range | null | undefined;
  splitTOCHref?: (href: string) => Promise<unknown[]> | unknown[];
  toc?: unknown[];
  transformTarget?: EventTarget;
}

export interface FoliateViewElement extends HTMLElement {
  book?: FoliateBookLike;
  close?(): void;
  deselect?(): void;
  flow?: FoliateFlow;
  getContents(): FoliateContent[];
  goLeft(): Promise<void>;
  goRight(): Promise<void>;
  goTo(target: unknown): Promise<void>;
  goToFraction?(fraction: number): Promise<void> | void;
  goToTextStart?(): Promise<void>;
  next(distance?: number): Promise<void>;
  open(input: File | Blob | string | FoliateBookLike): Promise<void>;
  prev(distance?: number): Promise<void>;
  renderer?: FoliateViewRenderer | null;
}
