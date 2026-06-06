export type ReaderChromeZone = "top" | "bottom" | null;

export type ReaderChromeState = {
  showBookTitle: boolean;
  showChapterTitle: boolean;
  showModeSwitch: boolean;
  showSectionNavigation: boolean;
};

export type ReaderViewMode = "pages" | "scroll";

export type ReaderChromeLayout = {
  reserveChromeSpace: boolean;
};

export function getReaderChromeState(zone: ReaderChromeZone): ReaderChromeState {
  const isTop = zone === "top";
  return {
    showBookTitle: isTop,
    showChapterTitle: !isTop,
    showModeSwitch: isTop,
    showSectionNavigation: zone === "bottom",
  };
}

export function getReaderChromeLayout(mode: ReaderViewMode): ReaderChromeLayout {
  void mode;
  return {
    reserveChromeSpace: true,
  };
}
