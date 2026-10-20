import { LockIcon, ScanIcon, ScissorsIcon, UserIcon, VideoIcon, Volume2Icon } from "lucide-react";

import { MotionUpload } from "#/features/genjutsu/components/motion-upload";
import { PickTile, tileMedia } from "#/features/genjutsu/components/pick-tile";
import { StepIntro, TipsPanel } from "#/features/genjutsu/components/step-intro";
import type { SampleMotion } from "#/features/genjutsu/contracts";
import { Hud } from "#/shared/components/brand";
import { LoopingVideo } from "#/shared/components/looping-video";
import type { Asset } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";
import { duration } from "#/shared/timecode";
import type { HoldForCode } from "#/shared/use-access-code";

/** A clip's length, with a speaker when it carries sound (the result keeps it). */
function ClipMeta({ clip }: { clip: Asset }) {
  return (
    <Hud className="inline-flex shrink-0 items-center gap-1.5" tone="foreground">
      {clip.has_audio && <Volume2Icon aria-label="Has sound" className="size-3.5" role="img" />}
      {duration(clip.duration_ms ?? 0)}
    </Hud>
  );
}

/**
 * Step 1, the motion: the upload tile first, then the clip of your own the URL names (shown once
 * the visitor may see it), then the sample motions as looping muted previews. A tile toggles the
 * pick (`onPick` with `undefined` unpicks).
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
    <>
      <StepIntro label="Step 1 of 4" title="Pick a motion">
        Your character will perform this move. Start from a sample, or bring a clip of your own.
      </StepIntro>
      <ul
        aria-label="Motions"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4"
      >
        <li>
          <MotionUpload
            onReady={onPick}
            hold={hold}
            release={release}
            selectedAssetId={motionId}
            signedIn={signedIn}
          />
        </li>
        {ownClip && (
          <li>
            <PickTile
              media={
                motion ? (
                  <LoopingVideo className={tileMedia} src={mediaUrl(motion)} />
                ) : (
                  <span className="absolute inset-0 grid place-items-center text-muted-foreground">
                    <LockIcon aria-hidden="true" className="size-7" />
                  </span>
                )
              }
              meta={motion ? <ClipMeta clip={motion} /> : <Hud tone="soft">Needs the code</Hud>}
              onToggle={() => onPick(undefined)}
              picked
              tag="Your clip"
              title={motion ? "Your clip" : "Your clip, locked"}
            />
          </li>
        )}
        {motions.map((sample) => (
          <li key={sample.id}>
            <PickTile
              media={<LoopingVideo className={tileMedia} src={mediaUrl(sample.clip)} />}
              meta={<ClipMeta clip={sample.clip} />}
              onToggle={() => onPick(sample.clip.id === motionId ? undefined : sample.clip.id)}
              picked={sample.clip.id === motionId}
              tag="Sample"
              title={sample.title}
            />
          </li>
        ))}
      </ul>
      <TipsPanel
        label="What makes a good clip"
        tips={[
          {
            icon: <UserIcon />,
            text: "The move is taken from a single performer.",
            title: "One person",
          },
          {
            icon: <ScanIcon />,
            text: "Head to feet, so every limb has a pose.",
            title: "Whole body in frame",
          },
          {
            icon: <VideoIcon />,
            text: "A locked-off shot keeps the motion clean.",
            title: "Steady camera",
          },
          { icon: <ScissorsIcon />, text: "Longer clips open a trimmer.", title: "3 to 8 seconds" },
        ]}
      />
    </>
  );
}
