export const PDFJS_VERBOSITY_ERRORS = 0;

interface PdfViewerApplicationOptionsLike {
  set?(name: string, value: unknown): void;
}

export interface PdfJsOptionsWindowLike {
  PDFViewerApplicationOptions?: PdfViewerApplicationOptionsLike | null;
}

export function setPdfJsVerbosityToErrors(
  win: PdfJsOptionsWindowLike,
): boolean {
  const options = win.PDFViewerApplicationOptions;
  if (!options || typeof options.set !== "function") return false;
  options.set.call(options, "verbosity", PDFJS_VERBOSITY_ERRORS);
  return true;
}
