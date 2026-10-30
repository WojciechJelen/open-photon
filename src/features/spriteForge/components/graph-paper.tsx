import { useId } from "react";

/**
 * The graph paper pixel art sits on, filling the nearest positioned box (give that box `bg-field`).
 * A pattern, not a scaled picture, so its lines stay one pixel at every size.
 */
export function GraphPaper({ cell }: { cell: 24 | 32 }) {
  const id = useId();

  return (
    <svg aria-hidden="true" className="absolute inset-0 size-full text-foreground/4">
      <defs>
        <pattern height={cell} id={id} patternUnits="userSpaceOnUse" width={cell}>
          <path d={`M0 .5H${cell}M.5 0V${cell}`} fill="none" stroke="currentColor" />
        </pattern>
      </defs>
      <rect fill={`url(#${id})`} height="100%" width="100%" />
    </svg>
  );
}
