// Options 页 Claude.ai 风格的扁平 row primitives。
//
// 设计：
//   - Section 只有一个 bold 标题，下面是若干 row。
//   - row 之间靠细分隔线区分，不靠 card 边框。
//   - row 左侧 label + 可选 description（muted），右侧 control（紧贴右）。
//   - FullRow 让 control 占满整行（slider、translation preview 等）。
//
// 控件原语：Switch（boolean）、Select（多选 native dropdown）、
// Segment（2~3 选文字段控件）、IconSegment（带图标的段控件，主题用）。
//
// 这些组件都是命令式 click 处理的，避免 Solid signal 在控件内部嵌套。

import { For, Show, type JSX } from "solid-js";
import { IconChevron } from "./icons";

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
}) {
  return (
    <button
      aria-checked={props.checked}
      aria-label={props.label}
      class="switch"
      classList={{ on: props.checked }}
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
}

export function Select<T extends string>(props: {
  value: T;
  options: SelectOption<T>[];
  onChange: (next: T) => void;
  label?: string;
  disabled?: boolean;
}) {
  // native select 兼容性最好；视觉用 wrapper + chevron 装饰。
  return (
    <span class="select" classList={{ disabled: props.disabled }}>
      <select
        aria-label={props.label}
        class="select-input"
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.value as T)}
        value={props.value}
      >
        <For each={props.options}>
          {(option) => <option value={option.value}>{option.label}</option>}
        </For>
      </select>
      <span aria-hidden="true" class="select-chevron">
        <IconChevron size={14} />
      </span>
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
