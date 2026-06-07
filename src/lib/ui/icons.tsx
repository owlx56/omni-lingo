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

export function IconUser(props: IconProps): JSX.Element {
  return icon(
    <>
      <path d="M19 21a7 7 0 0 0-14 0" />
      <circle cx="12" cy="7" r="4" />
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

export function IconLanguages(props: IconProps): JSX.Element {
  return icon(
    <>
      <path d="m5 8 6 6" />
      <path d="m4 14 6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="m22 22-5-10-5 10" />
      <path d="M14 18h6" />
    </>,
    props,
  );
}

export function IconMessageCircle(props: IconProps): JSX.Element {
  return icon(
    <>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
      <path d="M8 12h.01" />
      <path d="M12 12h.01" />
      <path d="M16 12h.01" />
    </>,
    props,
  );
}

export function IconBell(props: IconProps): JSX.Element {
  return icon(
    <>
      <path d="M10.27 21a2 2 0 0 0 3.46 0" />
      <path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.8 14.3 19 13.2 19 10a7 7 0 1 0-14 0c0 3.2-.8 4.3-1.74 5.33" />
    </>,
    props,
  );
}

export function IconSparkles(props: IconProps): JSX.Element {
  return icon(
    <>
      <path d="M9.9 3.1 8.4 7.3 4.2 8.8l4.2 1.5 1.5 4.2 1.5-4.2 4.2-1.5-4.2-1.5z" />
      <path d="M18.5 13.5 17.7 16l-2.5.8 2.5.8.8 2.5.8-2.5 2.5-.8-2.5-.8z" />
    </>,
    props,
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

export function IconMoreHorizontal(props: IconProps): JSX.Element {
  return icon(
    <>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </>,
    props,
    { fill: "currentColor", stroke: "none" },
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

export function IconUploadFile(props: IconProps): JSX.Element {
  return icon(
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v6h6" />
      <path d="M12 18v-6" />
      <path d="m9 15 3-3 3 3" />
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
  const size = props.size ?? 24;
  return (
    <svg
      aria-hidden="true"
      class={props.class}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path
        d="M14 4.7998C14 5.24152 13.6419 5.59961 13.2002 5.59961H5C4.77909 5.59961 4.59961 5.77909 4.59961 6V18C4.59961 18.2209 4.77909 18.4004 5 18.4004H6.2002C6.64192 18.4004 7 18.7585 7 19.2002C7 19.6419 6.64192 20 6.2002 20H5L4.7959 19.9893C3.78722 19.887 3 19.0357 3 18V6C3 4.89543 3.89543 4 5 4H13.2002C13.6419 4 14 4.35808 14 4.7998ZM19 4C20.1046 4 21 4.89543 21 6V18C21 19.0357 20.2128 19.887 19.2041 19.9893L19 20H10.7998C10.3581 20 10 19.6419 10 19.2002C10 18.7585 10.3581 18.4004 10.7998 18.4004H19C19.2209 18.4004 19.4004 18.2209 19.4004 18V6C19.4004 5.77909 19.2209 5.59961 19 5.59961H17.7998C17.3581 5.59961 17 5.24152 17 4.7998C17 4.35808 17.3581 4 17.7998 4H19Z"
        fill="currentColor"
      />
      <path
        d="M9.49261 15.9987C8.96837 15.9987 8.59583 15.4884 8.75553 14.989L10.8172 8.54302C10.9497 8.12877 11.3348 7.84766 11.7697 7.84766H12.2346C12.6695 7.84766 13.0545 8.12877 13.187 8.54302L15.2361 14.9496C15.402 15.4684 15.0149 15.9987 14.4702 15.9987C14.1074 15.9987 13.7895 15.7557 13.6943 15.4056L12.7006 11.7527C12.576 11.3273 12.455 10.8873 12.3376 10.4327C12.2276 9.97066 12.1103 9.52332 11.9856 9.09066H11.9416C11.839 9.53066 11.7253 9.97799 11.6006 10.4327C11.4833 10.8873 11.366 11.3273 11.2486 11.7527L10.2389 15.4297C10.1466 15.7657 9.84109 15.9987 9.49261 15.9987ZM10.0496 13.9087V12.6437H13.9216V13.9087H10.0496Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function IconBilingualMode(props: IconProps): JSX.Element {
  const size = props.size ?? 24;
  return (
    <svg
      aria-hidden="true"
      class={props.class}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path
        d="M12.6154 4H5C4.44772 4 4 4.44772 4 5V15C4 15.5523 4.44772 16 5 16H9.52384C9.90883 16 10.2596 15.779 10.4258 15.4317L14.1895 7.56827C14.3558 7.22101 14.7066 7 15.0915 7H19C19.5523 7 20 7.44772 20 8V18C20 18.5523 19.5523 19 19 19H10.7692"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="1.4"
      />
      <path
        d="M7.11453 10.5492L6.90563 11.3173C6.84619 11.5358 6.64775 11.6875 6.42125 11.6875C6.08601 11.6875 5.84498 11.3652 5.93974 11.0436L7.05435 7.26136C7.15463 6.9211 7.467 6.6875 7.82173 6.6875H7.98842C8.34378 6.6875 8.65654 6.92191 8.75627 7.26298L9.85802 11.0309C9.95398 11.3591 9.70787 11.6875 9.36592 11.6875C9.13369 11.6875 8.93047 11.5314 8.87057 11.307L8.66827 10.5492H7.11453ZM8.39307 9.51171L7.9344 7.78981H7.8656L7.39547 9.51171H8.39307Z"
        fill="currentColor"
      />
      <path
        d="M17.9893 15.9063C17.8945 16.0966 17.6762 16.1922 17.4748 16.1243C16.8658 15.9191 16.3734 15.6851 15.9976 15.4221C15.7749 15.5779 15.5156 15.7224 15.2198 15.8555C15.018 15.9485 14.794 16.0393 14.5478 16.1277C14.3417 16.2018 14.1147 16.1082 14.0131 15.9143C13.8786 15.6578 14.0188 15.344 14.2951 15.2574C14.7177 15.125 15.0641 14.9834 15.3343 14.8328C15.1434 14.612 14.9796 14.3636 14.8428 14.0877C14.7092 13.8117 14.5946 13.4984 14.4992 13.1477H14.2709C14.0544 13.1477 13.8788 12.9722 13.8788 12.7557C13.8788 12.5392 14.0544 12.3636 14.2709 12.3636H15.592C15.5892 12.3465 15.5863 12.3292 15.5833 12.3118C15.5369 12.0407 15.7309 11.782 16.0057 11.7691C16.2354 11.7583 16.4347 11.9262 16.4631 12.1544L16.4891 12.3636H17.7148C17.9313 12.3636 18.1068 12.5392 18.1068 12.7557C18.1068 12.9722 17.9313 13.1477 17.7148 13.1477H17.4531C17.3545 13.5114 17.2399 13.8312 17.1095 14.1071C16.9791 14.3831 16.8232 14.6282 16.6418 14.8425C16.9389 15.012 17.2848 15.15 17.6794 15.2567C17.9613 15.3329 18.1195 15.645 17.9893 15.9063ZM15.3725 13.1477C15.4838 13.6153 15.689 14.0097 15.9881 14.3312C16.128 14.1818 16.2442 14.0114 16.3364 13.8198C16.4319 13.625 16.513 13.401 16.5798 13.1477H15.3725Z"
        fill="currentColor"
      />
    </svg>
  );
}
