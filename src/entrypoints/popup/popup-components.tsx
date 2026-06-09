import { Show, type Accessor, type JSX } from "solid-js";
import type { FullPageEngineId } from "@/lib/storage/settings";
import type { SelectOption } from "@/lib/ui/controls";
import { IconSparkles } from "@/lib/ui/icons";

export function ProviderMark(props: { engine: FullPageEngineId }): JSX.Element {
  return (
    <span class="provider-icon-shell" aria-hidden="true">
      <Show
        fallback={
          <span class="provider-google-mark" aria-hidden="true">
            G
          </span>
        }
        when={props.engine === "microsoft"}
      >
        <span class="provider-microsoft-mark" aria-hidden="true">
          <span class="provider-microsoft-red" />
          <span class="provider-microsoft-green" />
          <span class="provider-microsoft-blue" />
          <span class="provider-microsoft-yellow" />
        </span>
      </Show>
    </span>
  );
}

export function AiStyleIcon(): JSX.Element {
  return <IconSparkles size={13} />;
}

export function renderAiConfigSelectValue<T extends string>(
  label: string,
): (option: Accessor<SelectOption<T>>) => JSX.Element {
  return (option) => (
    <span class="popup-ai-select-line">
      <span class="popup-ai-select-label">{label}:</span>
      <span class="popup-ai-select-value">
        {option().icon?.()}
        <span class="popup-ai-select-text">{option().label}</span>
      </span>
    </span>
  );
}

export function PopupSwitch(props: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange?: (next: boolean) => void;
}): JSX.Element {
  return (
    <button
      aria-checked={props.checked}
      aria-label={props.label}
      class="popup-switch"
      classList={{ on: props.checked }}
      disabled={props.disabled}
      onClick={() => props.onChange?.(!props.checked)}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" class="popup-switch-thumb" />
    </button>
  );
}

export function PopupAiConfigCard(props: {
  serviceLabel: string;
  serviceControl: JSX.Element;
  aiStyleLabel: string;
  aiStyleControl: JSX.Element;
  smartContextLabel: string;
}): JSX.Element {
  return (
    <section
      aria-label={`${props.serviceLabel}, ${props.aiStyleLabel}, ${props.smartContextLabel}`}
      class="popup-ai-config-card"
    >
      <div class="popup-ai-config-select-group">
        {props.serviceControl}
        {props.aiStyleControl}
      </div>
      <div class="popup-ai-config-row popup-ai-config-context-row">
        <span class="popup-ai-config-label">{props.smartContextLabel}</span>
        <PopupSwitch checked={false} disabled label={props.smartContextLabel} />
      </div>
    </section>
  );
}

export function SwitchRow(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}): JSX.Element {
  return (
    <div class="popup-switch-row">
      <span class="popup-switch-label">{props.label}</span>
      <PopupSwitch
        checked={props.checked}
        disabled={props.disabled}
        label={props.label}
        onChange={props.onChange}
      />
    </div>
  );
}

export function HeaderAction(props: {
  label: string;
  icon: (iconProps: { size?: number }) => JSX.Element;
}): JSX.Element {
  const Icon = props.icon;
  return (
    <button
      aria-label={props.label}
      class="popup-header-action"
      title={props.label}
      type="button"
    >
      <Icon size={16} />
    </button>
  );
}
