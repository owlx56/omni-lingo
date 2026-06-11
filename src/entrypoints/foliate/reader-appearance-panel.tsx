import { type JSX } from "solid-js";
import type { TFn } from "@/lib/i18n";
import {
  FOLIATE_READER_FONT_SIZE_MAX,
  FOLIATE_READER_FONT_SIZE_MIN,
  FOLIATE_READER_LINE_HEIGHT_MAX,
  FOLIATE_READER_LINE_HEIGHT_MIN,
  getLockedFoliateReaderSettings,
} from "./reader-settings";

const FOLIATE_READER_FONT_SIZE_STEP = 1;
const FOLIATE_READER_LINE_HEIGHT_STEP = 0.1;

type ReaderAppearanceLockedSettings = ReturnType<
  typeof getLockedFoliateReaderSettings
>;

type ReaderAppearancePanelProps = {
  fontSize: number;
  lineHeight: number;
  locked: ReaderAppearanceLockedSettings;
  onFontSizeChange: (value: number) => void;
  onFontSizeStep: (delta: number) => void;
  onLineHeightChange: (value: number) => void;
  onLineHeightStep: (delta: number) => void;
  onTextIndentChange: (value: boolean) => void;
  onUseBookLayoutChange: (value: boolean) => void;
  t: TFn;
  textIndent: boolean;
  useBookLayout: boolean;
};

type ReaderNumberStepperProps = {
  ariaLabel: string;
  disabled?: boolean;
  max: number;
  min: number;
  onChange: (value: number) => void;
  onStep: (delta: number) => void;
  step: number;
  unit: string;
  value: number;
};

export function ReaderAppearancePanel(
  props: ReaderAppearancePanelProps,
): JSX.Element {
  return (
    <section
      aria-label={props.t("viewer.appearance.title")}
      class="foliate-appearance-panel"
      data-omni-lingo-reader-ui=""
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      role="dialog"
    >
      <div class="foliate-appearance-panel-head">
        <span>{props.t("viewer.appearance.title")}</span>
      </div>
      <div class="foliate-appearance-row">
        <span>{props.t("viewer.appearance.fontSize")}</span>
        <ReaderNumberStepper
          ariaLabel={props.t("viewer.appearance.fontSize.aria")}
          max={FOLIATE_READER_FONT_SIZE_MAX}
          min={FOLIATE_READER_FONT_SIZE_MIN}
          onChange={props.onFontSizeChange}
          onStep={props.onFontSizeStep}
          step={FOLIATE_READER_FONT_SIZE_STEP}
          unit="px"
          value={props.fontSize}
        />
      </div>
      <div class="foliate-appearance-row">
        <span>{props.t("viewer.appearance.useBookLayout")}</span>
        <ReaderSwitch
          checked={props.useBookLayout}
          label={props.t("viewer.appearance.useBookLayout")}
          onChange={props.onUseBookLayoutChange}
        />
      </div>
      <div class="foliate-appearance-row">
        <span>{props.t("viewer.appearance.textIndent")}</span>
        <ReaderSwitch
          checked={props.textIndent}
          disabled={props.locked.textIndent}
          label={props.t("viewer.appearance.textIndent")}
          onChange={props.onTextIndentChange}
        />
      </div>
      <div class="foliate-appearance-row">
        <span>{props.t("viewer.appearance.lineHeight")}</span>
        <ReaderNumberStepper
          ariaLabel={props.t("viewer.appearance.lineHeight.aria")}
          disabled={props.locked.lineHeight}
          max={FOLIATE_READER_LINE_HEIGHT_MAX}
          min={FOLIATE_READER_LINE_HEIGHT_MIN}
          onChange={props.onLineHeightChange}
          onStep={props.onLineHeightStep}
          step={FOLIATE_READER_LINE_HEIGHT_STEP}
          unit="x"
          value={props.lineHeight}
        />
      </div>
    </section>
  );
}

function ReaderNumberStepper(props: ReaderNumberStepperProps): JSX.Element {
  const commit = (value: string): void => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    props.onChange(parsed);
  };

  return (
    <div
      class="foliate-appearance-stepper"
      classList={{ "is-disabled": Boolean(props.disabled) }}
    >
      <button
        aria-label={`${props.ariaLabel} -${props.step}`}
        disabled={props.disabled}
        onClick={() => props.onStep(-props.step)}
        type="button"
      >
        -
      </button>
      <input
        aria-label={props.ariaLabel}
        disabled={props.disabled}
        inputMode="decimal"
        max={props.max}
        min={props.min}
        onBlur={(event) => commit(event.currentTarget.value)}
        onChange={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            props.onStep(props.step);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            props.onStep(-props.step);
          }
        }}
        step="any"
        type="text"
        value={formatReaderSettingNumber(props.value)}
      />
      <span aria-hidden="true">{props.unit}</span>
      <button
        aria-label={`${props.ariaLabel} +${props.step}`}
        disabled={props.disabled}
        onClick={() => props.onStep(props.step)}
        type="button"
      >
        +
      </button>
    </div>
  );
}

function ReaderSwitch(props: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (value: boolean) => void;
}): JSX.Element {
  return (
    <button
      aria-checked={props.checked ? "true" : "false"}
      aria-label={props.label}
      class="foliate-appearance-switch"
      classList={{ "is-on": props.checked }}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      role="switch"
      type="button"
    >
      <span />
    </button>
  );
}

function formatReaderSettingNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}
