// The application's cross-feature hand-offs for a finished image: the one place that links an image
// result of one feature (a Shots & Angles view, a photoshoot variation, a storyboard card) to
// another feature's flow. The routes that render those results pass `AnimateAction` to the
// feature's actions seam; no feature imports another feature's page for this.
import { ClapperboardIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import { animateImageHref } from "#/features/animateImage";

/**
 * "Animate", an icon button: opens Animate Image with this generation's image output preselected
 * as its source. `variant` is `scrim` over a result's picture, `outline` on a card beside it.
 */
export function AnimateAction({
  generationId,
  output,
  variant = "scrim",
}: {
  generationId: string;
  output: string;
  variant?: "outline" | "scrim";
}) {
  return (
    <Button aria-label="Animate" asChild size="icon" title="Animate" variant={variant}>
      <a href={animateImageHref({ generationId, output })}>
        <ClapperboardIcon aria-hidden="true" strokeWidth={1.75} />
      </a>
    </Button>
  );
}
