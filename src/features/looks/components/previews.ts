// The preview of each option whose effect the benchmark showed: the 4.5 s frame of its take
// (`docs/look-benchmark-2026-10-23/`), the same character, motion and seed as every other option's,
// so the tiles compare like for like. Keyed by every such option's id, so a reliable option
// without a preview does not typecheck. Experimental options have none: their takes looked like
// the baseline.
import type { ReliableLookOption } from "#/features/looks/catalog";
import beach from "#/features/looks/previews/beach.jpg";
import neonStreet from "#/features/looks/previews/neon-street.jpg";

export const lookPreviews: Record<ReliableLookOption["id"], string> = {
  beach,
  "neon-street": neonStreet,
};
