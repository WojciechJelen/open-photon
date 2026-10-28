import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { type StoryboardStyle, storyboardStyles } from "#/features/storyboard/contracts";

const labels: Record<StoryboardStyle, string> = {
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
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium" id="storyboard-style">
        Style
      </span>
      <ToggleGroup
        aria-labelledby="storyboard-style"
        onValueChange={(next) => {
          const style = storyboardStyles.find((item) => item === next);

          if (style) {
            onChange(style);
          }
        }}
        type="single"
        value={value ?? ""}
        variant="outline"
      >
        {storyboardStyles.map((style) => (
          <ToggleGroupItem key={style} value={style}>
            {labels[style]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-xs text-muted-foreground">
        Naming the style keeps all four cards in one look; “Like the character” can drift.
      </p>
    </div>
  );
}
