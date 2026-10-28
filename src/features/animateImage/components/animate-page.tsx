import { useNavigate } from "@tanstack/react-router";
import { ClapperboardIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { requestAnimation } from "#/features/animateImage/animate-client";
import { AnimationTake } from "#/features/animateImage/components/animation-take";
import {
  type PickedSource,
  readPreselected,
  SourcePicker,
} from "#/features/animateImage/components/source-picker";
import {
  type AnimateImageInput,
  type AnimateSearch,
  animationPromptSchema,
  searchSource,
  VIDEO_SECONDS,
  videoSize,
} from "#/features/animateImage/contracts";
import { AccessCodeDialog, AccessStatus } from "#/shared/components/access-code-dialog";
import { Hud, PageGlow } from "#/shared/components/brand";
import { SiteHeader } from "#/shared/components/site";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";
import { useAccessCode } from "#/shared/use-access-code";

// Actions described the way Wan 2.2 follows them: who does what, and what the camera does.
const examples = [
  "Waves at the camera with one hand and smiles. Static camera.",
  "Slowly turns around to look over the shoulder, then back at the camera.",
  "The camera slowly orbits around the subject, which stays still.",
  "Takes a step forward and nods. Static camera, full body in frame.",
];

/**
 * `/animate`: Animate Image. The user picks the still to start from (an upload, a library
 * character, or a done generation's image another page hands over with `animateImageHref`),
 * describes what should happen, and renders a 5 s image-to-video clip (Wan 2.2 14B, no driving
 * video) through `POST /api/animations`. The animation the page follows is `?take=` in the URL,
 * so a reload or a shared link keeps it; its progress, video, Download, retry, result page and
 * share link are `AnimationTake`'s.
 */
export function AnimatePage({ search }: { search: AnimateSearch }) {
  const id = useId();
  const navigate = useNavigate({ from: "/animate" });
  const access = useAccessCode();
  const [signedIn, setSignedIn] = useState(true);
  const [picked, setPicked] = useState<PickedSource | null>(null);
  const [sourceProblem, setSourceProblem] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // The key of the request not answered yet: sent again with the same input after a lost answer,
  // so it finds the animation the first one started instead of starting another.
  const pendingKey = useRef<{ body: string; key: string } | null>(null);
  const { character, generation, output } = search;

  const onRefused = useCallback(
    (answer: Refusal, resume: () => void) => {
      if (answer.reason === "access_required") {
        setSignedIn(false);
        access.hold("animate", "unlock", () => {
          setSignedIn(true);
          resume();
        });
      }
    },
    [access.hold],
  );

  useEffect(() => {
    const source = searchSource({ character, generation, output });

    if (!source) {
      return;
    }

    let stopped = false;

    setSourceProblem(null);

    void readPreselected(source).then((answer) => {
      if (stopped) {
        return;
      }

      if ("picked" in answer) {
        setPicked(answer.picked);
      } else {
        setSourceProblem(answer.problem);
      }
    });

    return () => {
      stopped = true;
    };
  }, [character, generation, output]);

  const parsedPrompt = animationPromptSchema.safeParse(prompt);

  const size =
    picked?.image.width && picked.image.height
      ? videoSize(picked.image.width, picked.image.height)
      : null;

  async function generate() {
    if (!picked || !parsedPrompt.success) {
      return;
    }

    const input: AnimateImageInput = { prompt: parsedPrompt.data, source: picked.source };
    const body = JSON.stringify(input);

    if (pendingKey.current?.body !== body) {
      pendingKey.current = { body, key: crypto.randomUUID() };
    }

    setSending(true);
    setRefusal(null);

    const answer = await requestAnimation(input, pendingKey.current.key);

    setSending(false);

    if ("data" in answer) {
      pendingKey.current = null;
      void navigate({ search: (previous) => ({ ...previous, take: answer.data.id }) });
    } else if (answer.refusal.reason === "access_required") {
      onRefused(answer.refusal, () => void generate());
    } else {
      setRefusal(answer.refusal.message);
    }
  }

  return (
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <SiteHeader category="Video">
        <AccessStatus onOpen={access.unlock} signedIn={signedIn} />
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-250 flex-col gap-10 px-4 py-8 sm:px-8 sm:py-12">
        <div className="flex flex-col gap-3">
          <Hud>Video · Wan 2.2 14B image-to-video</Hud>
          <h1 className="font-display text-4xl leading-none font-bold tracking-display sm:text-5xl">
            Animate an image
          </h1>
          <p className="max-w-150 text-soft-foreground">
            Pick a still, describe what happens, and get a {VIDEO_SECONDS.toFixed(0)} second video
            of it. No motion clip needed: the movement comes from your words.
          </p>
        </div>

        <section aria-labelledby={`${id}-source`} className="flex flex-col gap-4">
          <h2 className="text-lg font-medium" id={`${id}-source`}>
            1. The image
          </h2>
          {sourceProblem && (
            <p className="text-sm text-destructive-foreground" role="alert">
              {sourceProblem}
            </p>
          )}
          <div className="grid gap-6 md:grid-cols-3">
            <figure className="flex flex-col gap-2">
              <div className="relative flex aspect-3/4 items-center justify-center overflow-hidden rounded-2xl border bg-screen">
                {picked ? (
                  <img
                    alt={`Image to animate: ${picked.label}`}
                    className="absolute inset-0 size-full object-contain"
                    src={mediaUrl(picked.image)}
                  />
                ) : (
                  <span className="px-4 text-center text-sm text-muted-foreground">
                    No image picked yet
                  </span>
                )}
              </div>
              {picked && (
                <figcaption className="truncate text-sm text-soft-foreground">
                  {picked.label}
                </figcaption>
              )}
            </figure>
            <div className="md:col-span-2">
              <SourcePicker onPick={setPicked} onRefused={onRefused} picked={picked} />
            </div>
          </div>
        </section>

        <section aria-labelledby={`${id}-action`} className="flex flex-col gap-4">
          <h2 className="text-lg font-medium" id={`${id}-action`}>
            2. The action
          </h2>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-prompt`}>What happens in the video</Label>
            <Textarea
              id={`${id}-prompt`}
              maxLength={1000}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              placeholder="The woman raises her hand, waves at the camera and smiles. Static camera."
              rows={3}
              value={prompt}
            />
            <p className="text-sm text-muted-foreground">
              Say who moves and how, and whether the camera moves. One clear action works best.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {examples.map((example) => (
              <Button key={example} onClick={() => setPrompt(example)} size="sm" variant="chip">
                {example}
              </Button>
            ))}
          </div>
        </section>

        <div className="flex flex-col items-start gap-3">
          <Button
            disabled={!picked || !parsedPrompt.success || sending}
            onClick={() => void generate()}
            size="lg"
          >
            <ClapperboardIcon />
            {sending ? "Starting…" : "Animate"}
          </Button>
          <p className="text-sm text-muted-foreground">
            {size
              ? `${size.width}×${size.height}, ${VIDEO_SECONDS.toFixed(1)} s at 16 fps, MP4.`
              : "Pick an image and describe the action to animate it."}
          </p>
          {refusal && (
            <p className="text-sm text-destructive-foreground" role="alert">
              {refusal}
            </p>
          )}
        </div>

        {search.take && (
          <section
            aria-labelledby={`${id}-take`}
            className="flex flex-col gap-4 rounded-2xl border p-5"
          >
            <h2 className="text-lg font-medium" id={`${id}-take`}>
              Your animation
            </h2>
            <AnimationTake
              id={search.take}
              key={search.take}
              onRefused={onRefused}
              onRetried={(take) => void navigate({ search: (previous) => ({ ...previous, take }) })}
            />
          </section>
        )}
      </main>
      <AccessCodeDialog {...access.dialog} />
    </div>
  );
}
