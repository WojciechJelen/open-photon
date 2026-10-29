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
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-sm font-medium" id="storyboard-style">
        Style
      </span>
      {/* Wider than a phone: the joined group scrolls sideways; the padding keeps focus rings unclipped. */}
      <div className="-m-1 overflow-x-auto p-1">
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
      </div>
      <p className="text-xs text-muted-foreground">
        Naming the style keeps all four cards in one look; “Like the character” can drift.
      </p>
    </div>
  );
}
