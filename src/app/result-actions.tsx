// The application's cross-feature hand-offs for a finished image: the one place that links an image
// result of one feature (a Shots & Angles view, a photoshoot variation, a storyboard card) to
// another feature's flow. The routes that render those results pass `AnimateAction` to the
// feature's actions seam; no feature imports another feature's page for this.
import { ClapperboardIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import { animateImageHref } from "#/features/animateImage";

/** "Animate": opens Animate Image with this generation's image output preselected as its source. */
export function AnimateAction({ generationId, output }: { generationId: string; output: string }) {
  return (
    <Button asChild size="sm" variant="outline">
      <a href={animateImageHref({ generationId, output })}>
        <ClapperboardIcon />
        Animate
      </a>
    </Button>
  );
}
