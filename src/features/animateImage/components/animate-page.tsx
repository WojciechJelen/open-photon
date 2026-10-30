import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { ClapperboardIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { requestAnimation } from "#/features/animateImage/animate-client";
import {
  AnimationTake,
  boxFit,
  TAKE_BOX,
  VIEWFINDER_CLEAR_OF_TAG,
} from "#/features/animateImage/components/animation-take";
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
import { AccessCodeDialog } from "#/shared/components/access-code-dialog";
import { Viewfinder } from "#/shared/components/brand";
import { PageHeading } from "#/shared/components/page-heading";
import { Panel } from "#/shared/components/panel";
import { ResultFigure } from "#/shared/components/result-figure";
import { SitePage } from "#/shared/components/site";
import { StableText } from "#/shared/components/stable-text";
import { StateCard } from "#/shared/components/state-card";
import { ToolColumns, ToolSection } from "#/shared/components/tool-layout";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";
import { useAccessCode } from "#/shared/use-access-code";

// Actions described the way Wan 2.2 follows them: who does what, and what the camera does.
const examples = [
  {
    label: "Wave and smile",
    prompt: "Waves at the camera with one hand and smiles. Static camera.",
  },
  {
    label: "Look over the shoulder",
    prompt: "Slowly turns around to look over the shoulder, then back at the camera.",
  },
  {
    label: "Slow camera orbit",
    prompt: "The camera slowly orbits around the subject, which stays still.",
  },
  {
    label: "Step forward and nod",
    prompt: "Takes a step forward and nods. Static camera, full body in frame.",
  },
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
  const navigate = useNavigate({ from: "/animate" });
  const access = useAccessCode();
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
        access.hold("animate", "unlock", resume);
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
      void navigate({
        resetScroll: false,
        search: (previous) => ({ ...previous, take: answer.data.id }),
      });
    } else if (answer.refusal.reason === "access_required") {
      onRefused(answer.refusal, () => void generate());
    } else {
      setRefusal(answer.refusal.message);
    }
  }

  const problem = refusal ?? (search.take ? sourceProblem : null);

  const animate = (
    <Button
      disabled={!picked || !parsedPrompt.success || sending}
      onClick={() => void generate()}
      variant="photon"
    >
      <ClapperboardIcon aria-hidden="true" />
      <StableText current={sending ? "Starting…" : "Animate"} labels={["Animate", "Starting…"]} />
    </Button>
  );

  const note = problem ? (
    <p className="type-caption wrap-anywhere text-destructive-foreground" role="alert">
      {problem}
    </p>
  ) : (
    <p className="type-caption wrap-anywhere text-muted-foreground">
      {size && `${size.width}×${size.height}, `}
      {VIDEO_SECONDS.toFixed(1)} s at 16 fps, MP4.
    </p>
  );

  const preview = picked && (
    <>
      <img
        alt={`Image to animate: ${picked.label}${picked.generated ? ", AI-generated" : ""}`}
        className={cn("absolute inset-0 size-full", boxFit(picked.image))}
        src={mediaUrl(picked.image)}
      />
      <Viewfinder className={VIEWFINDER_CLEAR_OF_TAG} />
    </>
  );

  const idle = sourceProblem ? (
    <div role="alert">
      <StateCard
        className={TAKE_BOX}
        icon={TriangleAlertIcon}
        text={sourceProblem}
        title="This image can't be animated"
        tone="warning"
      />
    </div>
  ) : picked?.generated === "tagged" ? (
    <ResultFigure aspect="aspect-9/16">{preview}</ResultFigure>
  ) : picked ? (
    <div className="relative aspect-9/16 overflow-hidden rounded-field bg-screen shadow-hairline">
      {preview}
    </div>
  ) : (
    <StateCard
      className={cn(TAKE_BOX, "px-11")}
      frame
      text="Pick a still and say what happens."
      title="Your clip appears here"
    />
  );

  return (
    <SitePage category="Video" gap={10} onAccess={access.unlock} top={10}>
      <ToolColumns
        asideClassName="sticky top-6"
        aside={
          <Panel
            aria-label="Your animation"
            className="gap-3.5 p-5"
            label="Your animation"
            role="region"
          >
            {/* Once the panel takes the page's width, the 9:16 box stops growing with it. */}
            <div className="mx-auto flex w-full max-w-90 min-w-0 flex-col gap-3.5">
              <AnimationTake
                animate={animate}
                id={search.take}
                idle={idle}
                key={search.take}
                note={note}
                onRefused={onRefused}
                onRetried={(take) =>
                  void navigate({
                    resetScroll: false,
                    search: (previous) => ({ ...previous, take }),
                  })
                }
                still={picked ? mediaUrl(picked.image) : undefined}
              />
            </div>
          </Panel>
        }
      >
        <PageHeading
          subtitle="Pick a still, say what happens, get a five-second clip."
          title="Animate image"
        />

        <ToolSection
          end={
            // The links keep 44 px targets; the row stays as low as its heading.
            <div className="-my-2 flex max-w-full min-w-0 flex-wrap gap-x-4">
              <Button asChild size="inline" variant="link">
                <Link search={{ draft: undefined }} to="/characters">
                  <span>Open library</span>
                </Link>
              </Button>
              <Button asChild size="inline" variant="link">
                <Link to="/characters/new">
                  <span>Describe a new one</span>
                </Link>
              </Button>
            </div>
          }
          number="01"
          title="Image"
        >
          <SourcePicker onPick={setPicked} onRefused={onRefused} picked={picked} />
        </ToolSection>

        <ToolSection number="02" title="Action">
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="animate-prompt">What happens</Label>
            <Textarea
              id="animate-prompt"
              maxLength={1000}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              placeholder="Waves at the camera with one hand and smiles. Static camera."
              rows={3}
              value={prompt}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {examples.map((example) => (
              <Button
                key={example.label}
                onClick={() => setPrompt(example.prompt)}
                size="sm"
                variant="chip"
              >
                <span className="type-caption font-medium">{example.label}</span>
              </Button>
            ))}
          </div>
        </ToolSection>
      </ToolColumns>

      <AccessCodeDialog {...access.dialog} />
    </SitePage>
  );
}
