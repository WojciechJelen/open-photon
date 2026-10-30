import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { type StoryboardStyle, storyboardStyles } from "#/features/storyboard/contracts";

export const styleLabels: Record<StoryboardStyle, string> = {
  anime: "Anime",
  illustration: "Illustration",
  realistic: "Photo",
  reference: "Like the character",
  "stylized-3d": "3D",
};

/** The look every card asks for: a named style, or the character image's own. */
export function StylePicker({
  onChange,
  value,
}: {
  onChange: (style: StoryboardStyle) => void;
  value: StoryboardStyle | null;
}) {
  return (
    <ToggleGroup
      aria-label="Look"
      onValueChange={(next) => {
        const style = storyboardStyles.find((item) => item === next);

        if (style) {
          onChange(style);
        }
      }}
      spacing={1}
      type="single"
      value={value ?? ""}
      variant="segmented"
    >
      {storyboardStyles.map((style) => (
        <ToggleGroupItem key={style} value={style}>
          {styleLabels[style]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
