import type { ReactNode } from "react";

import { Choice } from "#/features/spriteForge/components/choice";
import {
  GenerationState,
  imageOutput,
  statusText,
} from "#/features/spriteForge/components/generation-state";
import {
  directionLabels,
  type Facing,
  type SpriteSetView,
  VIEW_OUTPUT,
} from "#/features/spriteForge/contracts";
import { GENERATED_IMAGE_ALT } from "#/shared/components/generated-image";
import { ResultFigure } from "#/shared/components/result-figure";
import { mediaUrl } from "#/shared/media";
import type { HoldForCode } from "#/shared/use-access-code";
import { useLiveGeneration } from "#/shared/use-live-generation";

const facingOptions = [
  { label: "Left", value: "left" },
  { label: "Right", value: "right" },
] as const satisfies readonly { label: string; value: Facing }[];

/** A view's box before it has a picture: `ResultFigure`'s box and caption, without the tag. */
export function ViewPlaceholder({ caption, children }: { caption: string; children?: ReactNode }) {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2.5">
      <div className="relative aspect-3/5 overflow-hidden rounded-field border bg-screen">
        {children}
      </div>
      <figcaption className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="min-w-0 truncate type-label" title={caption}>
          {caption}
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * One direction of the set: its view once done, its state until then, and for a turned view which
 * side of the screen the character faces (the sheet flips rows from it, so a wrong guess walks
 * backwards).
 */
export function ViewCard({
  backdrop,
  facing,
  onAccess,
  onFacing,
  onRetried,
  view,
}: {
  backdrop?: string;
  facing: Facing | null;
  onAccess: HoldForCode;
  onFacing: (facing: Facing) => void;
  onRetried: () => void;
  view: SpriteSetView;
}) {
  const { generation } = useLiveGeneration(view.generation);
  const label = directionLabels[view.direction];
  const image = imageOutput(generation, VIEW_OUTPUT);

  return (
    <li aria-label={`${label}: ${statusText(generation)}`} className="flex min-w-0 flex-col gap-2">
      {image ? (
        <ResultFigure
          aspect="aspect-3/5"
          caption={label}
          meta={
            view.reused ? <span title="Already rendered: came back free.">Free</span> : undefined
          }
          tag="bottom"
        >
          <img
            alt={`${label} view, ${GENERATED_IMAGE_ALT}`}
            className="absolute inset-0 size-full object-cover"
            src={mediaUrl(image)}
          />
        </ResultFigure>
      ) : (
        <ViewPlaceholder caption={label}>
          <GenerationState
            backdrop={backdrop}
            generation={generation}
            label={label}
            onAccess={onAccess}
            onRetried={onRetried}
            what="view"
          />
        </ViewPlaceholder>
      )}
      {facing && (
        <Choice
          label={`${label} facing`}
          onChange={onFacing}
          options={facingOptions}
          value={facing}
        />
      )}
    </li>
  );
}
