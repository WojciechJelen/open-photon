import { useEffect, useId, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import type { CharacterSummary } from "#/features/characters/contracts";
import { characterName, patchCharacter, validTitle } from "#/features/characters/library";
import type { Refusal } from "#/shared/requests";

/** One opening of the rename dialog: the character, and an id no other opening has. */
export type RenameSession = { character: CharacterSummary; id: number };

/**
 * Renames a character of the library: a title of 1–80 characters (trimmed), saved with
 * `PATCH /api/characters/:id`. `session` opens it; `onRenamed` gets the saved character with the
 * session that saved it, even when that dialog was closed before the answer came, so the caller
 * keeps the name and closes only that session. A refusal (an expired session, a title the server
 * will not take) shows in the dialog, which stays open to try again. `onClosed` runs once it has
 * closed (Escape, Cancel, a save), to put the focus back where the rename started.
 */
export function RenameDialog({
  onAccessRequired,
  onClose,
  onClosed,
  onRenamed,
  session,
}: {
  onAccessRequired: () => void;
  onClose: () => void;
  onClosed: () => void;
  onRenamed: (character: CharacterSummary, session: number) => void;
  session: RenameSession | null;
}) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={session !== null}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          // Radix returns the focus to a trigger; this dialog has none, its opener says where.
          event.preventDefault();
          onClosed();
        }}
      >
        {session && (
          <RenameForm
            character={session.character}
            key={session.id}
            onAccessRequired={onAccessRequired}
            onClose={onClose}
            onRenamed={(character) => onRenamed(character, session.id)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  character,
  onAccessRequired,
  onClose,
  onRenamed,
}: {
  character: CharacterSummary;
  onAccessRequired: () => void;
  onClose: () => void;
  onRenamed: (character: CharacterSummary) => void;
}) {
  const id = useId();
  const [title, setTitle] = useState(character.title ?? "");
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // Whether this form is still shown: a refusal that comes after it closed is not shown.
  const shown = useRef(true);
  const valid = validTitle(title);

  useEffect(() => {
    shown.current = true;

    return () => {
      shown.current = false;
    };
  }, []);

  async function save() {
    if (!valid) {
      setRefusal({ message: "A name is 1–80 characters." });

      return;
    }

    setPending(true);
    setRefusal(null);

    const result = await patchCharacter(character.id, { title: title.trim() });

    if ("data" in result) {
      onRenamed(result.data);
    }

    if (!shown.current) {
      return;
    }

    setPending(false);

    if ("refusal" in result) {
      setRefusal(result.refusal);

      if (result.refusal.reason === "access_required") {
        onAccessRequired();
      }
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename character</DialogTitle>
        <DialogDescription>
          The new name shows for everyone in this workspace, wherever “{characterName(character)}”
          is listed.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor={id}>Name</Label>
          <Input
            aria-describedby={`${id}-hint`}
            aria-invalid={refusal !== null || (title !== "" && !valid)}
            autoComplete="off"
            id={id}
            maxLength={120}
            onChange={(event) => {
              setTitle(event.target.value);
              setRefusal(null);
            }}
            value={title}
          />
          <p className="text-sm text-muted-foreground" id={`${id}-hint`}>
            1–80 characters.
          </p>
          {refusal && (
            <p className="text-sm text-destructive-foreground" role="alert">
              {refusal.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={pending || !valid} type="submit">
            {pending ? "Saving…" : "Save name"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
