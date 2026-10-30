import { cn } from "cn";

/**
 * The "AI-generated" tag of `ResultFigure`, for the home page's outputs that are no figure;
 * `className` places it in their positioned box.
 */
export function AiTag({ className }: { className: string }) {
  return (
    <span
      className={cn(
        "absolute rounded-tag bg-background/66 px-1.75 py-0.75 type-tag text-foreground",
        className,
      )}
    >
      AI-generated
    </span>
  );
}
