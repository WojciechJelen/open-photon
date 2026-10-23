import batchVariations from "#/shared/assets/navigation/batch-variations.png";
import characters from "#/shared/assets/navigation/characters.png";
import createCharacter from "#/shared/assets/navigation/create-character.png";
import lookLighting from "#/shared/assets/navigation/look-lighting.png";
import motionPresets from "#/shared/assets/navigation/motion-presets.png";
import motionTransfer from "#/shared/assets/navigation/motion-transfer.png";

const artwork = {
  batchVariations,
  characters,
  createCharacter,
  lookLighting,
  motionPresets,
  motionTransfer,
};

export type NavigationIconName = keyof typeof artwork;

export function NavigationIcon({ name }: { name: NavigationIconName }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="size-11 shrink-0 object-contain"
      decoding="async"
      draggable={false}
      height={44}
      src={artwork[name]}
      width={44}
    />
  );
}
