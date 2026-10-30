import { ImageIcon, ShieldCheckIcon, UserRoundIcon } from "lucide-react";
import type { ComponentType } from "react";

import { StepTips } from "#/features/motionTransfer/components/step-intro";
import type { CharacterPickerProps } from "#/features/motionTransfer/slots";

/**
 * Step 2, the character: the character picker slot (`picker`, composed in
 * `src/app/composer-slots.ts`) and the photo tips.
 */
export function CharacterStep({
  picker: Picker,
  ...picker
}: CharacterPickerProps & {
  picker: ComponentType<CharacterPickerProps>;
}) {
  return (
    <>
      <Picker {...picker} />
      <section aria-label="What makes a good photo">
        <StepTips
          tips={[
            { icon: UserRoundIcon, text: "One person, clearly lit" },
            { icon: ImageIcon, text: "The photo sets the scene" },
            { icon: ShieldCheckIcon, text: "Only with their consent" },
          ]}
        />
      </section>
    </>
  );
}
