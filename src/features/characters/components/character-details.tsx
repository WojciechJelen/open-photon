import { useRef } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import type { CharacterSummary } from "#/features/characters/contracts";
import { characterName, modelName } from "#/features/characters/library";
import { Hud } from "#/shared/components/brand";
import { PublishLink } from "#/shared/components/publish-link";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** How a character came to be, in a line. */
function originLine(character: CharacterSummary) {
  const created = dateFormat.format(new Date(character.created_at));

  if (character.is_sample) {
    return "Sample character, AI-generated";
  }

  return character.origin === "upload" ? `Uploaded ${created}` : `AI image, generated ${created}`;
}

/**
 * What the library knows of a character, opened from its card's menu: its origin and date, the
 * prompt and what made it for a generated one, and for one saved from a generation "Publish & copy
 * link", or its share link once published (`onPublished` says when it is). `label` names it to
 * assistive technology. `onClosed` runs once it has closed, to put the focus back.
 */
export function CharacterDetails({
  character,
  label,
  onClose,
  onClosed,
  onPublished,
}: {
  character: CharacterSummary | null;
  label: string;
  onClose: () => void;
  onClosed: () => void;
  onPublished: (character: CharacterSummary, slug: string) => void;
}) {
  const content = useRef<HTMLDivElement>(null);

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={character !== null}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          // On the dialog, which is read first: publishing is never one key press away.
          event.preventDefault();
          content.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          // Radix returns the focus to a trigger; this dialog has none, its opener says where.
          event.preventDefault();
          onClosed();
        }}
        ref={content}
      >
        {character && (
          <>
            <DialogHeader>
              <DialogTitle>{characterName(character)}</DialogTitle>
              <DialogDescription>{originLine(character)}</DialogDescription>
            </DialogHeader>
            {character.prompt && (
              <div className="flex min-w-0 flex-col gap-1.5">
                <Hud>Prompt</Hud>
                <p
                  className="max-h-40 overflow-y-auto rounded-sm type-caption wrap-anywhere whitespace-pre-wrap text-soft-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  // The keys scroll a long prompt.
                  tabIndex={0}
                >
                  {character.prompt}
                </p>
              </div>
            )}
            {character.provenance && (
              <dl className="flex min-w-0 flex-col gap-1.5 type-caption wrap-anywhere text-soft-foreground">
                <dt>
                  <Hud>Made with</Hud>
                </dt>
                <dd>
                  {character.provenance.workflow.id} v{character.provenance.workflow.version}
                </dd>
                {character.provenance.models.map((model) => (
                  <dd key={model.sha256} title={`${model.file} · ${model.license}`}>
                    {modelName(model.file)}
                  </dd>
                ))}
              </dl>
            )}
            {character.generation_id && !character.is_sample && (
              <PublishLink
                compact
                generationId={character.generation_id}
                label={label}
                onPublished={(slug) => onPublished(character, slug)}
                slug={character.share_slug}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
