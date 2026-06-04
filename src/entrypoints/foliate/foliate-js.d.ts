declare module "foliate-js/footnotes.js" {
  export class FootnoteHandler extends EventTarget {
    detectFootnotes: boolean;
    handle(book: unknown, event: Event): Promise<void> | void;
  }
}
