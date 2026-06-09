// Claude.ai 风格扁平 row primitives，跨 entrypoint 共享。
//
// 设计：
//   - Section 只有一个 bold 标题，下面是若干 row。
//   - row 之间靠细分隔线区分，不靠 card 边框。
//   - row 左侧 label + 可选 description（muted），右侧 control（紧贴右）。
//   - FullRow 让 control 占满整行（slider 等）。
//
// 控件原语：Switch（boolean）、Select（多选 dropdown）、
// Segment（2~3 选文字段控件）、IconSegment（带图标的段控件，主题用）。
//
// 这些组件都是命令式 click 处理的，避免 Solid signal 在控件内部嵌套。

import {
  For,
  Show,
  type Accessor,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  type JSX,
} from "solid-js";
import { IconCheck, IconChevron } from "./icons";

export function Row(props: {
  label: string;
  description?: string;
  children: JSX.Element;
}) {
  return (
    <div class="row">
      <div class="row-info">
        <span class="row-label">{props.label}</span>
        <Show when={props.description}>
          <span class="row-desc">{props.description}</span>
        </Show>
      </div>
      <div class="row-control">{props.children}</div>
    </div>
  );
}

export function FullRow(props: {
  label?: string;
  description?: string;
  children: JSX.Element;
}) {
  return (
    <div class="row row-full">
      <Show when={props.label}>
        <div class="row-info">
          <span class="row-label">{props.label}</span>
          <Show when={props.description}>
            <span class="row-desc">{props.description}</span>
          </Show>
        </div>
      </Show>
      <div class="row-control row-control-full">{props.children}</div>
    </div>
  );
}

export function Switch(props: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      aria-checked={props.checked}
      aria-label={props.label}
      class="switch"
      classList={{ on: props.checked }}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" class="switch-thumb" />
    </button>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  icon?: () => JSX.Element;
}

export function Select<T extends string>(props: {
  value: T;
  options: SelectOption<T>[];
  onChange: (next: T) => void;
  label?: string;
  disabled?: boolean;
  class?: string;
  menuClass?: string;
  menuPlacement?: "left" | "right";
  renderValue?: (option: Accessor<SelectOption<T>>) => JSX.Element;
  renderOption?: (option: SelectOption<T>) => JSX.Element;
}) {
  let root: HTMLSpanElement | undefined;
  let button: HTMLButtonElement | undefined;
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(-1);
  const selectedIndex = createMemo(() => {
    const index = props.options.findIndex((option) => option.value === props.value);
    return index >= 0 ? index : 0;
  });
  const selectedOption = createMemo(() => props.options[selectedIndex()]);

  const close = (): void => {
    setOpen(false);
  };
  const openMenu = (): void => {
    if (props.disabled) return;
    setActiveIndex(-1);
    setOpen(true);
  };
  const selectOption = (option: SelectOption<T>): void => {
    props.onChange(option.value);
    close();
    button?.focus();
  };

  const handleDocumentPointerDown = (event: PointerEvent): void => {
    if (!root?.contains(event.target as Node)) close();
  };
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  onCleanup(() => {
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
  });

  const moveActive = (delta: number): void => {
    if (props.options.length === 0) return;
    setActiveIndex((current) => {
      if (current < 0) return selectedIndex();
      const next = current + delta;
      if (next < 0) return props.options.length - 1;
      if (next >= props.options.length) return 0;
      return next;
    });
  };

  const handleKeyDown: JSX.EventHandlerUnion<HTMLButtonElement, KeyboardEvent> = (
    event,
  ) => {
    if (props.disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open()) openMenu();
      else moveActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open()) openMenu();
      else moveActive(-1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open()) {
        openMenu();
        return;
      }
      const option = props.options[
        activeIndex() >= 0 ? activeIndex() : selectedIndex()
      ];
      if (option) selectOption(option);
    }
  };

  return (
    <span class="select" classList={{ disabled: props.disabled, open: open() }} ref={root}>
      <button
        aria-activedescendant={
          open() && activeIndex() >= 0
            ? `${id}-option-${activeIndex()}`
            : undefined
        }
        aria-controls={`${id}-menu`}
        aria-expanded={open()}
        aria-label={props.label}
        class={`select-button ${props.class ?? ""}`}
        disabled={props.disabled}
        onClick={() => {
          if (open()) close();
          else openMenu();
        }}
        onKeyDown={handleKeyDown}
        ref={button}
        role="combobox"
        type="button"
      >
        <Show when={selectedOption()}>
          {(option) => (
            <Show
              fallback={
                <span class="select-value">
                  {option().icon?.()}
                  <span class="select-value-text">{option().label}</span>
                </span>
              }
              when={props.renderValue}
            >
              {(renderValue) => renderValue()(option)}
            </Show>
          )}
        </Show>
        <span aria-hidden="true" class="select-chevron">
          <IconChevron size={15} />
        </span>
      </button>
      <Show when={open()}>
        <div
          class={`select-menu select-menu-${props.menuPlacement ?? "right"} ${props.menuClass ?? ""}`}
          id={`${id}-menu`}
          role="listbox"
        >
          <For each={props.options}>
            {(option, index) => (
              <button
                aria-selected={props.value === option.value}
                class="select-option"
                classList={{
                  active: activeIndex() === index(),
                  selected: props.value === option.value,
                }}
                id={`${id}-option-${index()}`}
                onClick={() => selectOption(option)}
                role="option"
                type="button"
              >
                <Show
                  fallback={
                    <span class="select-option-label">
                      {option.icon?.()}
                      <span>{option.label}</span>
                    </span>
                  }
                  when={props.renderOption}
                >
                  {(renderOption) => renderOption()(option)}
                </Show>
                <Show when={props.value === option.value}>
                  <span aria-hidden="true" class="select-option-check">
                    <IconCheck size={17} />
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </span>
  );
}

export interface SegmentOption<T> {
  value: T;
  label: string;
}

export function Segment<T extends string | number>(props: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (next: T) => void;
  label?: string;
}) {
  return (
    <div aria-label={props.label} class="segment" role="group">
      <For each={props.options}>
        {(option) => (
          <button
            class="segment-button"
            classList={{ active: props.value === option.value }}
            onClick={() => props.onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}

export interface IconSegmentOption<T> {
  value: T;
  label: string;
  icon: (props: { size?: number }) => JSX.Element;
}

export function IconSegment<T extends string>(props: {
  value: T;
  options: IconSegmentOption<T>[];
  onChange: (next: T) => void;
  label?: string;
}) {
  return (
    <div aria-label={props.label} class="icon-segment" role="group">
      <For each={props.options}>
        {(option) => {
          const Icon = option.icon;
          return (
            <button
              aria-label={option.label}
              class="icon-segment-button"
              classList={{ active: props.value === option.value }}
              onClick={() => props.onChange(option.value)}
              title={option.label}
              type="button"
            >
              <Icon size={16} />
            </button>
          );
        }}
      </For>
    </div>
  );
}
