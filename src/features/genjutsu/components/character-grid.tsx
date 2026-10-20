import { Button } from "#/components/ui/button";
import type { PickableCharacter } from "#/features/genjutsu/contracts";
import { mediaUrl } from "#/shared/media";

/** The sample characters' reference images; picking one names it. */
export function CharacterGrid({
  characters,
  onPick,
  selectedId,
}: {
  characters: PickableCharacter[];
  onPick: (characterId: string) => void;
  selectedId: string | undefined;
}) {
  return (
    <ul aria-label="Sample characters" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {characters.map((character) => (
        <li className="flex flex-col gap-2" key={character.id}>
          <img
            alt=""
            className="aspect-3/4 w-full rounded-md bg-muted object-cover"
            src={mediaUrl(character.image)}
          />
          <Button
            aria-pressed={character.id === selectedId}
            onClick={() => onPick(character.id)}
            variant={character.id === selectedId ? "default" : "outline"}
          >
            {character.title}
          </Button>
        </li>
      ))}
    </ul>
  );
}
