// 跨 entrypoint 共享的 inline SVG 图标（options + popup 都用）。
// 都用 currentColor 配合 CSS var --text / --text-muted 自然换色。

import type { JSX } from "solid-js";

type IconProps = { class?: string; size?: number };

function svg(path: JSX.Element, size = 16): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="1.6"
      viewBox="0 0 24 24"
      width={size}
    >
      {path}
    </svg>
  );
}

export function IconChevron(props: IconProps): JSX.Element {
  return svg(<path d="M6 9l6 6 6-6" />, props.size ?? 14);
}

export function IconCheck(props: IconProps): JSX.Element {
  return svg(<path d="M20 6L9 17l-5-5" />, props.size ?? 16);
}

export function IconSettings(props: IconProps): JSX.Element {
  return svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>,
    props.size ?? 16,
  );
}

export function IconLogo(props: IconProps): JSX.Element {
  // 文字气泡 + 翻译箭头占位 logo
  return svg(
    <>
      <path d="M4 5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H10l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      <path d="M7 9h6" />
      <path d="M7 12h4" />
    </>,
    props.size ?? 22,
  );
}

export function IconExternalLink(props: IconProps): JSX.Element {
  return svg(
    <>
      <path d="M14 4h6v6" />
      <path d="M10 14L20 4" />
      <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </>,
    props.size ?? 14,
  );
}

export function IconSidebar(props: IconProps): JSX.Element {
  return svg(
    <>
      <path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M9 4v16" />
      <path d="M5 8h3" />
      <path d="M5 12h3" />
      <path d="M5 16h3" />
    </>,
    props.size ?? 16,
  );
}

export function IconPages(props: IconProps): JSX.Element {
  return svg(
    <>
      <path d="M7 5h5v14H7z" />
      <path d="M12 5h5v14h-5z" />
    </>,
    props.size ?? 16,
  );
}

export function IconScroll(props: IconProps): JSX.Element {
  return svg(
    <>
      <path d="M12 4v16" />
      <path d="M8 8l4-4 4 4" />
      <path d="M8 16l4 4 4-4" />
    </>,
    props.size ?? 16,
  );
}

export function IconArrowLeftDouble(props: IconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      width={props.size ?? 16}
    >
      <path d="M8.37 12l4.95 4.95-1.42 1.41L5.54 12l6.36-6.36 1.42 1.41L8.37 12zm6 0 4.95 4.95-1.42 1.41L11.54 12l6.36-6.36 1.42 1.41L14.37 12z" />
    </svg>
  );
}

export function IconArrowRightDouble(props: IconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      width={props.size ?? 16}
    >
      <path d="M15.63 12l-4.95-4.95 1.42-1.41L18.46 12l-6.36 6.36-1.42-1.41L15.63 12zm-6 0L4.68 7.05 6.1 5.64 12.46 12 6.1 18.36l-1.42-1.41L9.63 12z" />
    </svg>
  );
}

export function IconPin(props: IconProps): JSX.Element {
  return (
    <svg aria-hidden="true" fill="currentColor" height={props.size ?? 16} viewBox="0 0 24 24" width={props.size ?? 16}>
      <path d="M14 4v5c0 1.12.37 2.16 1 3H9c.65-.86 1-1.9 1-3V4h4m3-2H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3V4h1c.55 0 1-.45 1-1s-.45-1-1-1z" />
    </svg>
  );
}

export function IconPinFilled(props: IconProps): JSX.Element {
  return (
    <svg aria-hidden="true" fill="currentColor" height={props.size ?? 16} viewBox="0 0 24 24" width={props.size ?? 16}>
      <path fill-rule="evenodd" d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
    </svg>
  );
}

export function IconInfo(props: IconProps): JSX.Element {
  return svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.5v5" />
      <path d="M12 7.5h.01" />
    </>,
    props.size ?? 16,
  );
}

export function IconClose(props: IconProps): JSX.Element {
  return svg(
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>,
    props.size ?? 16,
  );
}
