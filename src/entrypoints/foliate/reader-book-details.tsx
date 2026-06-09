import { For, Show, createSignal, type JSX } from "solid-js";
import { IconChevron } from "@/lib/ui/icons";

export type MetadataSection = {
  key: string;
  label: string;
  value: string;
};

export type SeriesItem = {
  key: string;
  label: string;
  position: string;
};

type DetailsSectionKind = "fields" | "series" | "description";

type DetailsSectionProps = {
  emptyLabel: string;
  items: MetadataSection[] | SeriesItem[] | string[];
  kind: DetailsSectionKind;
  label: string;
};

export function DetailsSection({
  kind,
  label,
  emptyLabel,
  items,
}: DetailsSectionProps): JSX.Element {
  const [open, setOpen] = createSignal(true);

  return (
    <section class={`foliate-details-section is-${kind}`}>
      <button
        class="foliate-details-section-head"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span>{label}</span>
        <IconChevron size={14} />
      </button>
      <Show when={open()}>
        <div class="foliate-details-section-body">
          <Show
            when={items.length > 0}
            fallback={<p class="foliate-details-empty-text">{emptyLabel}</p>}
          >
            {kind === "description" ? (
              <For each={items as string[]}>
                {(item) => <p class="foliate-details-description">{item}</p>}
              </For>
            ) : kind === "series" ? (
              <div class="foliate-details-series-list">
                <For each={items as SeriesItem[]}>
                  {(item) => (
                    <div class="foliate-details-series-item">
                      <strong>{item.label}</strong>
                      <span>{item.position}</span>
                    </div>
                  )}
                </For>
              </div>
            ) : (
              <dl class="foliate-details-field-list">
                <For each={items as MetadataSection[]}>
                  {(item) => (
                    <>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </>
                  )}
                </For>
              </dl>
            )}
          </Show>
        </div>
      </Show>
    </section>
  );
}
