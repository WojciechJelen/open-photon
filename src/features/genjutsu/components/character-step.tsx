import { ImageIcon, LockIcon, ShieldCheckIcon, UserIcon } from "lucide-react";

import { CharacterUpload } from "#/features/genjutsu/components/character-upload";
import { PickTile, tileMedia } from "#/features/genjutsu/components/pick-tile";
import { StepIntro, TipsPanel } from "#/features/genjutsu/components/step-intro";
import type { PickableCharacter } from "#/features/genjutsu/contracts";
import type { WizardSearch } from "#/features/genjutsu/wizard";
import { Hud } from "#/shared/components/brand";
import { mediaUrl } from "#/shared/media";
import type { HoldForCode } from "#/shared/use-access-code";

/**
 * Step 2, the character: the photo upload tile first, then the photo of your own the URL names
 * (shown once the visitor may see it), then the sample characters, framed like casting cards. A
 * tile toggles the pick (`onPick` with `undefined` unpicks).
 */
export function CharacterStep({
  back,
  character,
  characterId,
  characters,
  hold,
  onPick,
  release,
  signedIn,
}: {
  back: WizardSearch;
  character: PickableCharacter | null;
  characterId: string | undefined;
  characters: PickableCharacter[];
  hold: HoldForCode;
  onPick: (characterId: string | undefined) => void;
  release: (key: string) => void;
  signedIn: boolean;
}) {
  const ownPhoto = characterId !== undefined && !characters.some(({ id }) => id === characterId);

  return (
    <>
      <StepIntro
        back={{ label: "Motion", search: back }}
        label="Step 2 of 4"
        title="Who performs it?"
      >
        Pick a sample character or upload a photo. They take on the move, the timing and the framing
        of your clip.
      </StepIntro>
      <ul
        aria-label="Characters"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4"
      >
        <CharacterUpload
          onReady={onPick}
          hold={hold}
          release={release}
          selectedId={characterId}
          signedIn={signedIn}
        />
        {ownPhoto && (
          <li>
            <PickTile
              media={
                character ? (
                  <img alt="" className={tileMedia} src={mediaUrl(character.image)} />
                ) : (
                  <span className="absolute inset-0 grid place-items-center text-muted-foreground">
                    <LockIcon aria-hidden="true" className="size-7" />
                  </span>
                )
              }
              meta={character ? undefined : <Hud tone="soft">Needs the code</Hud>}
              onToggle={() => onPick(undefined)}
              picked
              tag="Your photo"
              title={character ? "Your photo" : "Your photo, locked"}
            />
          </li>
        )}
        {characters.map((sample) => (
          <li key={sample.id}>
            <PickTile
              media={<img alt="" className={tileMedia} src={mediaUrl(sample.image)} />}
              onToggle={() => onPick(sample.id === characterId ? undefined : sample.id)}
              picked={sample.id === characterId}
              tag="Sample"
              title={sample.title ?? "Sample character"}
            />
          </li>
        ))}
      </ul>
      <TipsPanel
        label="What makes a good photo"
        tips={[
          {
            icon: <UserIcon />,
            text: "A sharp face and outfit give the most faithful result.",
            title: "One person, clearly lit",
          },
          {
            icon: <ImageIcon />,
            text: "By default the background comes from the photo. You can change it in the next step.",
            title: "The photo sets the scene",
          },
          {
            icon: <ShieldCheckIcon />,
            text: "Upload yourself, or someone who agreed to it. You confirm this once per photo.",
            title: "Only with consent",
          },
        ]}
      />
    </>
  );
}
