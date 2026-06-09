import { For, Show, type JSX } from "solid-js";
import type { TranslationColor } from "@/lib/storage/settings";
import type { TFn } from "@/lib/i18n";
import type { TabId } from "@/lib/options-tabs";
import { COLOR_PRESETS, TABS } from "./options-model";

export function Sidebar(props: {
  activeTab: TabId;
  onSelect: (tab: TabId) => void;
  t: TFn;
}): JSX.Element {
  return (
    <nav aria-label="Settings sections" class="sidebar">
      <For each={TABS}>
        {(tab) => {
          const Icon = tab.icon;
          return (
            <button
              class="sidebar-item"
              classList={{ active: props.activeTab === tab.id }}
              onClick={() => props.onSelect(tab.id)}
              type="button"
            >
              <Icon size={16} />
              <span>{props.t(tab.labelKey)}</span>
            </button>
          );
        }}
      </For>
    </nav>
  );
}

export function ColorRowControl(props: {
  value: TranslationColor;
  customColor: string;
  t: TFn;
  onSelect: (next: TranslationColor) => void;
  onCustom: (color: string) => void;
}): JSX.Element {
  return (
    <div class="color-control">
      <For each={COLOR_PRESETS}>
        {(preset) => (
          <button
            aria-label={props.t(preset.labelKey)}
            class="color-swatch-button"
            classList={{ active: props.value === preset.value }}
            onClick={() => props.onSelect(preset.value)}
            style={{ "--swatch": preset.swatch }}
            title={props.t(preset.labelKey)}
            type="button"
          >
            <span aria-hidden="true" class="color-swatch-dot" />
          </button>
        )}
      </For>
      <label
        class="color-swatch-button color-swatch-button-custom"
        classList={{ active: props.value === "custom" }}
        title={props.t("color.custom")}
      >
        <span aria-hidden="true" class="color-swatch-dot" />
        <input
          aria-label={props.t("color.custom.aria")}
          class="color-swatch-input"
          onInput={(event) => {
            props.onCustom(event.currentTarget.value);
          }}
          type="color"
          value={props.customColor}
        />
      </label>
    </div>
  );
}

export function NumberStepper(props: {
  ariaLabel: string;
  disabled?: boolean;
  max: number;
  min: number;
  onCommit: () => void;
  onInput: (value: string) => void;
  onStep: (delta: number) => void;
  step: number;
  unit?: string;
  value: string;
}): JSX.Element {
  return (
    <div class="number-stepper" classList={{ "is-disabled": props.disabled }}>
      <button
        aria-label={`${props.ariaLabel} -${props.step}`}
        class="number-stepper-button"
        disabled={props.disabled}
        onClick={() => props.onStep(-props.step)}
        type="button"
      >
        -
      </button>
      <input
        aria-label={props.ariaLabel}
        class="number-stepper-input"
        disabled={props.disabled}
        inputMode="decimal"
        max={props.max}
        min={props.min}
        onBlur={props.onCommit}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (props.disabled) return;
          if (event.key === "Enter") {
            event.currentTarget.blur();
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            props.onStep(props.step);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            props.onStep(-props.step);
          }
        }}
        step="any"
        type="text"
        value={props.value}
      />
      <Show when={props.unit}>
        <span aria-hidden="true" class="number-stepper-unit">
          {props.unit}
        </span>
      </Show>
      <button
        aria-label={`${props.ariaLabel} +${props.step}`}
        class="number-stepper-button"
        disabled={props.disabled}
        onClick={() => props.onStep(props.step)}
        type="button"
      >
        +
      </button>
    </div>
  );
}
