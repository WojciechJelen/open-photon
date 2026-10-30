import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";

/** One choice among a few, as a radio group named `label`. */
export function Choice<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: T) => void;
  options: readonly { disabled?: boolean; label: string; value: T }[];
  value: T;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      onValueChange={(next) => {
        const picked = options.find((option) => option.value === next);

        if (picked) {
          onChange(picked.value);
        }
      }}
      spacing={1}
      type="single"
      value={value}
      variant="segmented"
    >
      {options.map((option) => (
        <ToggleGroupItem disabled={option.disabled} key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
