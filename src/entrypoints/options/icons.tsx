// Options 页用到的 inline SVG 图标。
// 都用 currentColor，配合 CSS var --text / --text-muted 自然换色。

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

export function IconUser(props: IconProps): JSX.Element {
  return svg(
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </>,
    props.size ?? 16,
  );
}

export function IconHover(props: IconProps): JSX.Element {
  return svg(
    <>
      <path d="M5 3l4 14 2.5-5.5L17 9l-12-6z" />
      <path d="M14 14l5 5" />
    </>,
    props.size ?? 16,
  );
}

export function IconSelection(props: IconProps): JSX.Element {
  return svg(
    <>
      <path d="M4 6V4h2" />
      <path d="M20 6V4h-2" />
      <path d="M4 18v2h2" />
      <path d="M20 18v2h-2" />
      <path d="M4 10v4" />
      <path d="M20 10v4" />
      <path d="M10 4h4" />
      <path d="M10 20h4" />
    </>,
    props.size ?? 16,
  );
}

export function IconImmersive(props: IconProps): JSX.Element {
  return svg(
    <>
      <rect height="16" rx="2" width="18" x="3" y="4" />
      <path d="M3 9h18" />
      <path d="M8 14h8" />
      <path d="M8 17h5" />
    </>,
    props.size ?? 16,
  );
}

export function IconSystem(props: IconProps): JSX.Element {
  return svg(
    <>
      <rect height="13" rx="2" width="18" x="3" y="4" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </>,
    props.size ?? 16,
  );
}

export function IconSun(props: IconProps): JSX.Element {
  return svg(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2" />
      <path d="M12 19v2" />
      <path d="M3 12h2" />
      <path d="M19 12h2" />
      <path d="M5.6 5.6l1.4 1.4" />
      <path d="M17 17l1.4 1.4" />
      <path d="M5.6 18.4l1.4-1.4" />
      <path d="M17 7l1.4-1.4" />
    </>,
    props.size ?? 16,
  );
}

export function IconMoon(props: IconProps): JSX.Element {
  return svg(
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
    props.size ?? 16,
  );
}

export function IconLogo(props: IconProps): JSX.Element {
  // OneLingo 占位 logo：一个文字气泡 + 翻译箭头。
  return svg(
    <>
      <path d="M4 5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H10l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      <path d="M7 9h6" />
      <path d="M7 12h4" />
    </>,
    props.size ?? 22,
  );
}
