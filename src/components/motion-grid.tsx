import { LoopingVideo } from "#/components/looping-video";
import { Button } from "#/components/ui/button";
import type { SampleMotion } from "#/lib/contracts";
import { mediaUrl } from "#/lib/media";

/** The sample motions as looping muted previews; picking one names its clip. */
export function MotionGrid({
  motions,
  onPick,
  selectedAssetId,
}: {
  motions: SampleMotion[];
  onPick: (assetId: string) => void;
  selectedAssetId: string | undefined;
}) {
  return (
    <ul aria-label="Sample motions" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {motions.map((motion) => (
        <li className="flex flex-col gap-2" key={motion.id}>
          <LoopingVideo label={motion.title} src={mediaUrl(motion.clip)} />
          <Button
            aria-pressed={motion.clip.id === selectedAssetId}
            onClick={() => onPick(motion.clip.id)}
            variant={motion.clip.id === selectedAssetId ? "default" : "outline"}
          >
            {motion.title}
          </Button>
        </li>
      ))}
    </ul>
  );
}
