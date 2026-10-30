import {
  LockIcon,
  ScanIcon,
  ScissorsIcon,
  UserRoundIcon,
  VideoIcon,
  Volume2Icon,
} from "lucide-react";

import { MotionUpload } from "#/features/motionTransfer/components/motion-upload";
import { PickTile, tileMedia } from "#/features/motionTransfer/components/pick-tile";
import { StepTips } from "#/features/motionTransfer/components/step-intro";
import type { SampleMotion } from "#/features/motionTransfer/contracts";
import { LoopingVideo } from "#/shared/components/looping-video";
import type { Asset } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";
import type { HoldForCode } from "#/shared/use-access-code";

// A clip's place in the row: about 200 px wide, with the upload tile taking what is left; on a
// phone, where that tile wraps under it, two to a row.
const clipItem = "max-w-57.5 min-w-0 flex-1 basis-50 max-sm:max-w-1/2 max-sm:basis-2/5";

/** A clip's length, with a speaker when it carries sound (the result keeps it). */
function ClipMeta({ clip }: { clip: Asset }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 type-caption text-muted-foreground">
      {clip.has_audio && <Volume2Icon aria-label="Has sound" className="size-3.5" role="img" />}
      {Number(((clip.duration_ms ?? 0) / 1000).toFixed(1))} s
    </span>
  );
}

/**
 * Step 1, the motion: the sample motions as looping muted previews, the clip of your own the URL
 * names (shown once the visitor may see it), and the upload tile, which takes the rest of the row.
 * A tile toggles the pick (`onPick` with `undefined` unpicks).
 */
export function MotionStep({
  hold,
  motion,
  motionId,
  motions,
  onPick,
  release,
  signedIn,
}: {
  hold: HoldForCode;
  motion: Asset | null;
  motionId: string | undefined;
  motions: SampleMotion[];
  onPick: (assetId: string | undefined) => void;
  release: (key: string) => void;
  signedIn: boolean;
}) {
  const ownClip = motionId !== undefined && !motions.some(({ clip }) => clip.id === motionId);

  return (
    <ul aria-label="Motions" className="flex flex-wrap items-stretch gap-4">
      {motions.map((sample) => (
        <li className={clipItem} key={sample.id}>
          <PickTile
            meta={<ClipMeta clip={sample.clip} />}
            onToggle={() => onPick(sample.clip.id === motionId ? undefined : sample.clip.id)}
            picked={sample.clip.id === motionId}
            title={sample.title}
          >
            <LoopingVideo className={tileMedia} src={mediaUrl(sample.clip)} />
          </PickTile>
        </li>
      ))}
      {ownClip && (
        <li className={clipItem}>
          <PickTile
            meta={motion ? <ClipMeta clip={motion} /> : undefined}
            onToggle={() => onPick(undefined)}
            picked
            title={motion ? "Your clip" : "Your clip, locked"}
          >
            {motion ? (
              <LoopingVideo className={tileMedia} src={mediaUrl(motion)} />
            ) : (
              <span className="absolute inset-0 grid place-items-center text-muted-foreground">
                <LockIcon aria-hidden="true" className="size-7" />
              </span>
            )}
          </PickTile>
        </li>
      )}
      <li className="min-w-0 grow-999 basis-85">
        <MotionUpload
          hold={hold}
          onReady={onPick}
          release={release}
          selectedAssetId={motionId}
          signedIn={signedIn}
        >
          <StepTips
            className="justify-center pt-3"
            tips={[
              { icon: UserRoundIcon, text: "One person" },
              { icon: ScanIcon, text: "Whole body in frame" },
              { icon: VideoIcon, text: "Steady camera" },
              { icon: ScissorsIcon, text: "3 to 8 seconds" },
            ]}
          />
        </MotionUpload>
      </li>
    </ul>
  );
}
