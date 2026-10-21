import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, ImageIcon, LockIcon, PlayIcon, UserIcon, VideoIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { CharacterStep } from "#/features/motionTransfer/components/character-step";
import { DirectStep } from "#/features/motionTransfer/components/direct-step";
import { MotionStep } from "#/features/motionTransfer/components/motion-step";
import {
  MotionTransferHeader,
  type HeaderStep,
} from "#/features/motionTransfer/components/motion-transfer-header";
import { ShotSlate, type SlateRow } from "#/features/motionTransfer/components/shot-slate";
import type { loadSelection } from "#/features/motionTransfer/selection.functions";
import { type Direction, generateHold, useGenerate } from "#/features/motionTransfer/use-generate";
import { shownStep, type WizardSearch, type WizardStep } from "#/features/motionTransfer/wizard";
import { AccessCodeDialog } from "#/shared/components/access-code-dialog";
import { PageGlow } from "#/shared/components/brand";
import { ClipStill } from "#/shared/components/clip-still";
import { mediaUrl } from "#/shared/media";
import { duration } from "#/shared/timecode";
import { useAccessCode } from "#/shared/use-access-code";

type Selection = Awaited<ReturnType<typeof loadSelection>>;

const nextStep: Record<WizardStep, WizardStep> = {
  character: "direct",
  direct: "direct",
  motion: "character",
};

/**
 * The Motion Transfer wizard at `/motionTransfer`: Motion → Character → Direct, one decision per screen, then
 * Generate opens Render at `/g/:id`. The step and both picks live in the URL (`search`), so a
 * reload, Back and Forward and a deep link land on the same screen; a step whose prerequisites
 * are missing shows the furthest one it can reach (`shownStep`), and the URL follows it. A pick
 * replaces the history entry, a step change adds one. The direction (angle, look, seed) stays
 * while the wizard is open; a link `from` a take ("Change the shot", the remixes) starts it with
 * that take's. The access code is asked for by one dialog, which then carries on
 * with what asked for it (an upload, Generate).
 */
export function MotionTransferWizard({
  search,
  selection,
}: {
  search: WizardSearch;
  selection: Selection;
}) {
  const navigate = useNavigate();

  const {
    angles,
    character,
    characterId,
    characters,
    motion,
    motionId,
    motions,
    placeholderAngles,
    sampleTakeId,
    signedIn,
  } = selection;

  // The URL's choices, whether or not their details show: an upload needs the code to show, and
  // keeps its id through that.
  const motionChoice = motionId ?? undefined;
  const characterChoice = characterId ?? undefined;
  const step = shownStep(search.step, { character: characterId, motion: motionId });
  const formId = useId();
  const main = useRef<HTMLElement>(null);
  const shownBefore = useRef(step);

  // The take the URL comes from sets where the direction starts; else As filmed, blank, default.
  const [direction, setDirection] = useState<Direction>(
    () => selection.direction ?? { angle: "none", prompt: "", seed: "" },
  );

  const access = useAccessCode();
  const { release } = access;
  const generate = useGenerate(access.hold);

  // The URL names the step shown, so Back and Forward retrace it.
  useEffect(() => {
    if (search.step !== step) {
      void navigate({
        replace: true,
        resetScroll: false,
        search: (previous) => ({ ...previous, step }),
        to: "/motionTransfer",
      });
    }
  }, [navigate, search.step, step]);

  // A Generate that waited for the code is let go once its step is left: nothing shows it then.
  useEffect(() => {
    if (step !== "direct") {
      release(generateHold);
    }
  }, [release, step]);

  // A new step takes the focus to its heading, as a new page would.
  useEffect(() => {
    if (shownBefore.current !== step) {
      shownBefore.current = step;
      main.current?.querySelector("h1")?.focus();
    }
  }, [step]);

  const at = (target: WizardStep): WizardSearch => ({ ...search, step: target });

  const pickMotion = (assetId: string | undefined) =>
    navigate({
      replace: true,
      resetScroll: false,
      search: (previous) => ({ ...previous, motion: assetId, step }),
      to: "/motionTransfer",
    });

  const pickCharacter = (id: string | undefined) =>
    navigate({
      replace: true,
      resetScroll: false,
      search: (previous) => ({ ...previous, character: id, step }),
      to: "/motionTransfer",
    });

  const sampleMotion = motions.find(({ clip }) => clip.id === motionChoice);
  const angleLabel = angles.find(({ id }) => id === direction.angle)?.label ?? "As filmed";

  const motionRow: SlateRow = {
    change: step !== "motion" ? at("motion") : undefined,
    done: motionChoice !== undefined,
    empty: "Not picked yet",
    icon: <VideoIcon />,
    label: "Motion",
    thumb: motion ? <ClipStill src={mediaUrl(motion)} /> : null,
    value: motionChoice
      ? `${sampleMotion?.title ?? "Your clip"}${motion ? ` · ${duration(motion.duration_ms ?? 0)}` : ""}`
      : null,
  };

  const characterRow: SlateRow = {
    change: step === "direct" ? at("character") : undefined,
    done: characterChoice !== undefined,
    empty: step === "motion" ? "Next step" : "Not picked yet",
    icon: <UserIcon />,
    label: "Character",
    thumb: character ? (
      <img
        alt=""
        className="absolute inset-0 size-full object-cover"
        src={mediaUrl(character.image)}
      />
    ) : null,
    value: characterChoice ? (character?.title ?? "Your photo") : null,
  };

  const cameraRow: SlateRow = {
    done: false,
    empty: "As filmed",
    icon: <VideoIcon />,
    label: "Camera",
    short: true,
    thumb: null,
    // A direction set and left stays on the slate; until then it reads as the default.
    value: step === "direct" || direction.angle !== "none" ? angleLabel : null,
  };

  const lookRow: SlateRow = {
    done: false,
    empty: "From the photo",
    icon: <ImageIcon />,
    label: "Look",
    short: true,
    thumb: null,
    value: direction.prompt.trim() || (step === "direct" ? "From the photo" : null),
  };

  const steps: HeaderStep[] = [
    {
      label: "Motion",
      search: at("motion"),
      state: step === "motion" ? "current" : motionChoice ? "done" : "todo",
    },
    {
      label: "Character",
      search: motionChoice ? at("character") : null,
      state: step === "character" ? "current" : characterChoice ? "done" : "todo",
    },
    {
      label: "Direct",
      search: motionChoice && characterChoice ? at("direct") : null,
      state: step === "direct" ? "current" : "todo",
    },
    { label: "Render", search: null, state: "todo" },
  ];

  const picked = step === "motion" ? motionChoice : characterChoice;

  const action = (place: "bar" | "panel") =>
    step === "direct" ? (
      // Keyed apart from Continue: React would otherwise turn the clicked Continue into this
      // submit button before the click's default action runs, and submit the form.
      <Button
        disabled={generate.pending}
        form={formId}
        key="generate"
        size={place === "panel" ? "lg" : "default"}
        type="submit"
        variant="photon"
      >
        <PlayIcon className="fill-current" />
        {generate.pending ? "Starting…" : "Generate"}
      </Button>
    ) : (
      <Button
        disabled={!picked}
        key="continue"
        onClick={() => void navigate({ search: at(nextStep[step]), to: "/motionTransfer" })}
        size={place === "panel" ? "lg" : "default"}
        type="button"
      >
        {picked || place === "bar"
          ? "Continue"
          : `Pick a ${step === "motion" ? "motion" : "character"} to continue`}
        {(picked || place === "bar") && <ArrowRightIcon />}
      </Button>
    );

  const note =
    step === "direct"
      ? "Renders with Wan Animate 2 on open weights. You can leave while it runs."
      : signedIn
        ? "Your access code is active: uploads and renders are open."
        : sampleTakeId
          ? "Uploads and new renders need an access code. Sample pairs already rendered open without one."
          : "Uploads and new renders need an access code.";

  const locked = !signedIn && ((motionChoice && !motion) || (characterChoice && !character));

  return (
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <MotionTransferHeader onAccess={access.unlock} signedIn={signedIn} steps={steps} />
      <main
        className="mx-auto w-full max-w-330 px-4 pt-5 pb-36 sm:px-8 lg:pt-12 lg:pb-18"
        ref={main}
      >
        <div className="flex items-start gap-8">
          <div className="flex min-w-0 flex-1 flex-col gap-7">
            {locked && (
              <section
                aria-label="Private choices"
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning/5 px-5 py-4"
              >
                <LockIcon aria-hidden="true" className="size-5 shrink-0 text-warning-foreground" />
                <p className="min-w-0 flex-1 text-sm text-soft-foreground">
                  This link names your own {motionChoice && !motion ? "clip" : "photo"}
                  {motionChoice && !motion && characterChoice && !character ? " and photo" : ""}:
                  enter the access code to see it here. Generate keeps it and asks for the code too.
                </p>
                <Button onClick={access.unlock} size="sm" variant="outline">
                  Enter code
                </Button>
              </section>
            )}
            {step === "motion" && (
              <MotionStep
                hold={access.hold}
                motion={motion}
                motionId={motionChoice}
                motions={motions}
                onPick={(assetId) => void pickMotion(assetId)}
                release={release}
                signedIn={signedIn}
              />
            )}
            {step === "character" && (
              <CharacterStep
                back={at("motion")}
                character={character}
                characterId={characterChoice}
                characters={characters}
                hold={access.hold}
                onPick={(id) => void pickCharacter(id)}
                release={release}
                signedIn={signedIn}
              />
            )}
            {step === "direct" && (
              <DirectStep
                angles={angles}
                back={at("character")}
                direction={direction}
                errors={generate.errors}
                failure={generate.failure}
                formId={formId}
                motionPreview={motion ? mediaUrl(motion) : null}
                onChange={setDirection}
                onSubmit={() =>
                  generate.submit({ character: characterChoice, motion: motionChoice }, direction)
                }
                placeholderAngles={placeholderAngles}
              />
            )}
          </div>
          <ShotSlate
            action={action}
            barRow={step === "motion" ? motionRow : step === "character" ? characterRow : cameraRow}
            note={note}
            rows={[motionRow, characterRow, cameraRow, lookRow]}
          />
        </div>
      </main>
      <AccessCodeDialog {...access.dialog} sampleTakeId={sampleTakeId} />
    </div>
  );
}
