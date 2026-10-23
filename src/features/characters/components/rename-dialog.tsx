import { useId, useState } from "react";

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

/**
 * Renames a character of the library: a title of 1–80 characters (trimmed), saved with
 * `PATCH /api/characters/:id`. `character` opens it; `onRenamed` gets the saved character. A
 * refusal (an expired session, a title the server will not take) shows in the dialog, which stays
 * open to try again.
 */
export function RenameDialog({
  character,
  onAccessRequired,
  onClose,
  onRenamed,
}: {
  character: CharacterSummary | null;
  onAccessRequired: () => void;
  onClose: () => void;
  onRenamed: (character: CharacterSummary) => void;
}) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={character !== null}>
      <DialogContent>
        {character && (
          <RenameForm
            character={character}
            key={character.id}
            onAccessRequired={onAccessRequired}
            onClose={onClose}
            onRenamed={onRenamed}
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
  const valid = validTitle(title);

  async function save() {
    if (!valid) {
      setRefusal({ message: "A name is 1–80 characters." });

      return;
    }

    setPending(true);
    setRefusal(null);

    const result = await patchCharacter(character.id, { title: title.trim() });

    setPending(false);

    if ("refusal" in result) {
      setRefusal(result.refusal);

      if (result.refusal.reason === "access_required") {
        onAccessRequired();
      }

      return;
    }

    onRenamed(result.data);
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
