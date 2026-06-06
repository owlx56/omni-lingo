import type { JSX } from "solid-js";

export type IconProps = { class?: string; size?: number };

function icon(
  path: JSX.Element,
  props: IconProps,
  options?: {
    defaultSize?: number;
    fill?: "none" | "currentColor";
    stroke?: "none" | "currentColor";
    strokeWidth?: number;
    viewBox?: string;
  },
): JSX.Element {
  const fill = options?.fill ?? "none";
  const stroke = options?.stroke ?? "currentColor";
  return (
    <svg
      aria-hidden="true"
      class={props.class}
      fill={fill}
      height={props.size ?? options?.defaultSize ?? 16}
      stroke={stroke}
      stroke-linecap={stroke === "none" ? undefined : "round"}
      stroke-linejoin={stroke === "none" ? undefined : "round"}
      stroke-width={stroke === "none" ? undefined : (options?.strokeWidth ?? 2)}
      viewBox={options?.viewBox ?? "0 0 24 24"}
      width={props.size ?? options?.defaultSize ?? 16}
    >
      {path}
    </svg>
  );
}

export function IconChevron(props: IconProps): JSX.Element {
  return icon(<path d="m6 9 6 6 6-6" />, props, { defaultSize: 14 });
}

export function IconCheck(props: IconProps): JSX.Element {
  return icon(<path d="M20 6 9 17l-5-5" />, props);
}

export function IconSettings(props: IconProps): JSX.Element {
  return icon(
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>,
    props,
  );
}

export function IconLogo(props: IconProps): JSX.Element {
  return icon(
    <>
      <path d="M4 5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H10l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      <path d="M7 9h6" />
      <path d="M7 12h4" />
    </>,
    props,
    { defaultSize: 22 },
  );
}

export function IconExternalLink(props: IconProps): JSX.Element {
  return icon(
    <>
      <path d="M14 4h6v6" />
      <path d="M10 14 20 4" />
      <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </>,
    props,
    { defaultSize: 14 },
  );
}

export function IconSidebar(props: IconProps): JSX.Element {
  return icon(
    <>
      <rect height="18" rx="2" width="18" x="3" y="3" />
      <path d="M9 3v18" />
    </>,
    props,
  );
}

export function IconPages(props: IconProps): JSX.Element {
  return icon(
    <>
      <rect height="16" rx="2.5" width="16" x="4" y="4" />
      <path d="M12 4v16" />
      <path d="M8 8.5h.01" />
      <path d="M16 8.5h.01" />
    </>,
    props,
  );
}

export function IconScroll(props: IconProps): JSX.Element {
  return icon(
    <>
      <rect height="16" rx="2.5" width="16" x="4" y="4" />
      <path d="M4 10h16" />
      <path d="M4 15h16" />
    </>,
    props,
  );
}

export function IconArrowLeftDouble(props: IconProps): JSX.Element {
  return icon(
    <path d="M8.37 12l4.95 4.95-1.42 1.41L5.54 12l6.36-6.36 1.42 1.41L8.37 12zm6 0 4.95 4.95-1.42 1.41L11.54 12l6.36-6.36 1.42 1.41L14.37 12z" />,
    props,
    { fill: "currentColor", stroke: "none" },
  );
}

export function IconArrowRightDouble(props: IconProps): JSX.Element {
  return icon(
    <path d="M15.63 12l-4.95-4.95 1.42-1.41L18.46 12l-6.36 6.36-1.42-1.41L15.63 12zm-6 0L4.68 7.05 6.1 5.64 12.46 12 6.1 18.36l-1.42-1.41L9.63 12z" />,
    props,
    { fill: "currentColor", stroke: "none" },
  );
}

export function IconArrowRight(props: IconProps): JSX.Element {
  return icon(
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>,
    props,
    { defaultSize: 24 },
  );
}

export function IconPin(props: IconProps): JSX.Element {
  return icon(
    <path d="M14 4v5c0 1.12.37 2.16 1 3H9c.65-.86 1-1.9 1-3V4h4m3-2H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3V4h1c.55 0 1-.45 1-1s-.45-1-1-1z" />,
    props,
    { fill: "currentColor", stroke: "none" },
  );
}

export function IconPinFilled(props: IconProps): JSX.Element {
  return icon(
    <path fill-rule="evenodd" d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />,
    props,
    { fill: "currentColor", stroke: "none" },
  );
}

export function IconInfo(props: IconProps): JSX.Element {
  return icon(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>,
    props,
  );
}

export function IconClose(props: IconProps): JSX.Element {
  return icon(
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>,
    props,
  );
}

export function IconHover(props: IconProps): JSX.Element {
  return icon(
    <>
      <path d="m4 4 7.1 17 2.5-7.4L21 11.1Z" />
      <path d="m14 14 5 5" />
    </>,
    props,
  );
}

export function IconSelection(props: IconProps): JSX.Element {
  return icon(
    <>
      <path d="M5 4h14" />
      <path d="M5 20h14" />
      <path d="M9 4v16" />
      <path d="M15 4v16" />
    </>,
    props,
  );
}

export function IconImmersive(props: IconProps): JSX.Element {
  return icon(
    <>
      <rect height="16" rx="2" width="18" x="3" y="4" />
      <path d="M7 9h10" />
      <path d="M7 13h7" />
      <path d="M7 17h4" />
    </>,
    props,
  );
}

export function IconFile(props: IconProps): JSX.Element {
  return icon(
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v6h6" />
      <path d="M12 18v-6" />
      <path d="M9 15h6" />
    </>,
    props,
  );
}

export function IconSystem(props: IconProps): JSX.Element {
  return icon(
    <>
      <rect height="13" rx="2" width="18" x="3" y="4" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </>,
    props,
  );
}

export function IconSun(props: IconProps): JSX.Element {
  return icon(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </>,
    props,
  );
}

export function IconMoon(props: IconProps): JSX.Element {
  return icon(
    <path d="M20.99 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 20.99 12.79z" />,
    props,
  );
}

export function IconReplaceMode(props: IconProps): JSX.Element {
  return icon(
    <>
      <path d="M7 5H4v14h3" />
      <path d="M17 5h3v14h-3" />
      <path d="m9 16 3-8 3 8" />
      <path d="M10.1 13h3.8" />
    </>,
    props,
    { defaultSize: 30 },
  );
}

export function IconBilingualMode(props: IconProps): JSX.Element {
  return icon(
    <>
      <rect height="11" rx="2" width="11" x="4" y="4" />
      <rect height="11" rx="2" width="11" x="9" y="9" />
      <path d="m7 12 2.2-5 2.2 5" />
      <path d="M7.8 10h2.8" />
      <path d="M12.5 15h4.5" />
      <path d="M14.8 12.8v5.2" />
      <path d="M12.8 18c1.9-.7 3.2-2 3.6-4" />
      <path d="M17.4 18c-1.7-.6-2.8-1.7-3.3-3.3" />
    </>,
    props,
    { defaultSize: 30 },
  );
}
