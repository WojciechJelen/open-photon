import characters from "#/shared/assets/navigation/characters.png";
import createCharacter from "#/shared/assets/navigation/create-character.png";
import motionTransfer from "#/shared/assets/navigation/motion-transfer.png";

const artwork = {
  characters,
  createCharacter,
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
