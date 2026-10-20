import { cn } from "cn";

/**
 * A still of a clip: its frame at `at` seconds (a media fragment), muted and never played. It
 * fills its positioned box, cropped, unless `className` says otherwise; without a `label` it is
 * decoration, hidden from assistive technology.
 */
export function ClipStill({
  at = 1,
  className,
  label,
  src,
}: {
  at?: number;
  className?: string;
  label?: string;
  src: string;
}) {
  return (
    <video
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      className={cn("absolute inset-0 size-full object-cover", className)}
      muted
      playsInline
      preload="metadata"
      src={`${src}#t=${at}`}
    />
  );
}
