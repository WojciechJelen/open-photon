import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, ImageIcon, LockIcon, UserRoundIcon, VideoIcon } from "lucide-react";
import { type ComponentType, useEffect, useId, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { CharacterStep } from "#/features/motionTransfer/components/character-step";
import { DirectStep, GenerateProblems } from "#/features/motionTransfer/components/direct-step";
import { MotionStep } from "#/features/motionTransfer/components/motion-step";
import {
  MotionTransferHeader,
  type HeaderStep,
} from "#/features/motionTransfer/components/motion-transfer-header";
import { ShotSlate, type SlateRow } from "#/features/motionTransfer/components/shot-slate";
import { StepIntro } from "#/features/motionTransfer/components/step-intro";
import {
  defaultDirection,
  type Direction,
  directionFields,
  type MotionTransferDraft,
  parseDraft,
  shownStep,
  snapshotDraft,
  startingDirection,
  type WizardStep,
} from "#/features/motionTransfer/draft";
import type { loadSelection } from "#/features/motionTransfer/selection.functions";
import type {
  CharacterPickerProps,
  ComposerSlots,
  DirectGenerationActionsProps,
  DirectionEditorProps,
} from "#/features/motionTransfer/slots";
import { generateHold, useGenerate } from "#/features/motionTransfer/use-generate";
import { AccessCodeDialog } from "#/shared/components/access-code-dialog";
import { ClipStill } from "#/shared/components/clip-still";
import { SitePage } from "#/shared/components/site";
import { ToolColumns } from "#/shared/components/tool-layout";
import { mediaUrl } from "#/shared/media";
import { useAccessCode } from "#/shared/use-access-code";

type Selection = Awaited<ReturnType<typeof loadSelection>>;

type WizardProps = {
  /** Fills the Character step's picker slot (`src/app/composer-slots.ts`). */
  characterPicker: ComponentType<CharacterPickerProps>;
  /** The draft shown: the URL's of `/motionTransfer`, validated by `motionTransferDraftSchema`. */
  draft: MotionTransferDraft;
  /** Fills the Direct step's direction editor slot (`src/app/composer-slots.ts`). */
  directionEditor: ComponentType<DirectionEditorProps>;
  /** Fills the Direct step's generation actions slot, in the slate (`src/app/composer-slots.ts`). */
  generationActions: ComponentType<DirectGenerationActionsProps>;
  /** Fills the slate's Look row (`src/app/composer-slots.ts`). */
  lookName: ComposerSlots["lookName"];
  selection: Selection;
};

const nextStep: Record<WizardStep, WizardStep> = {
  character: "direct",
  direct: "direct",
  motion: "character",
};

const intros: Record<WizardStep, { sentence: string; title: string }> = {
  character: {
    sentence: "They take on the move, the timing and the framing of your clip.",
    title: "Who performs it?",
  },
  direct: {
    sentence: "Restyle the character and the scene, or go straight to Generate.",
    title: "Direct the shot",
  },
  motion: { sentence: "Your character performs this move.", title: "Pick a motion" },
};

/**
 * The Motion Transfer wizard at `/motionTransfer`: Motion → Character → Direct, one decision per
 * screen, then Generate opens Render at `/g/:id`. It owns its URL: it shows `draft`, the URL's,
 * and writes every change to the URL, so a reload, Back and Forward and a deep link land on the
 * same screen; a step whose prerequisites are missing shows the furthest one it can reach
 * (`shownStep`), and the URL follows it. A pick replaces the history entry, a step change adds
 * one. Another page opens it on a draft with `draftHref`. The direction (look, seed) is the
 * Direct step's form while the wizard is open; it starts from the draft's direction fields over
 * the direction of the take the draft comes `from` ("Change the shot", the remixes), another
 * `from` opens the form afresh, and every edit is written to the URL's direction fields (the
 * history entry replaced), so a reload and the step links keep it. A URL whose direction fields
 * the form did not write (Back, Forward, a link) starts the form again as a reload of it would:
 * its fields over the `from` take's direction, else the default. The
 * access code is asked for by one dialog, which then carries on with what asked for it (an
 * upload, Generate).
 */
export function MotionTransferWizard(props: WizardProps) {
  return <Wizard key={props.draft.from ?? ""} {...props} />;
}

/**
 * The URL's direction fields for `direction`, as the route's search decodes them: a field that
 * does not validate (a look over 500 characters, a seed that is not a number) is left out.
 */
function urlDirection(direction: Direction) {
  const { prompt, seed } = parseDraft(directionFields(direction));

  return { prompt, seed };
}

function fieldsKey({ prompt, seed }: MotionTransferDraft) {
  return JSON.stringify([prompt, seed]);
}

function Wizard({
  characterPicker,
  draft,
  directionEditor,
  generationActions: GenerationActions,
  lookName,
  selection,
}: WizardProps) {
  const navigate = useNavigate();

  const { character, characterId, characters, motion, motionId, motions, sampleTakeId, signedIn } =
    selection;

  // The draft's choices, whether or not their details show: an upload needs the code to show, and
  // keeps its id through that.
  const motionChoice = motionId ?? undefined;
  const characterChoice = characterId ?? undefined;
  const step = shownStep(draft.step, { character: characterId, motion: motionId });
  const formId = useId();
  const main = useRef<HTMLElement>(null);
  const shownBefore = useRef(step);

  // The draft's direction fields, over the take it comes from; else blank, default.
  const [direction, setDirection] = useState<Direction>(() =>
    startingDirection(draft, selection.direction ?? defaultDirection),
  );

  // The URL's direction fields the form last saw, and those its own edits wrote that the URL has
  // not shown yet (a navigation can land after the next keystroke).
  const urlFields = fieldsKey(draft);
  const seenFields = useRef(urlFields);
  const written = useRef<string[]>([]);

  const startDirection = selection.direction ?? defaultDirection;

  useEffect(() => {
    const fields = { prompt: draft.prompt, seed: draft.seed };
    const key = fieldsKey(fields);

    if (seenFields.current === key) {
      return;
    }

    seenFields.current = key;
    const own = written.current.indexOf(key);

    if (own === -1) {
      // Not the form's own edit landing: the same URL must make the same take however it was
      // reached, so resolve it as a fresh load does, not over what the form held before.
      written.current = [];
      setDirection(startingDirection(fields, startDirection));
    } else {
      written.current.splice(0, own + 1);
    }
  }, [draft.prompt, draft.seed, startDirection]);

  const changeDirection = (next: Direction) => {
    setDirection(next);

    const fields = urlDirection(next);
    const key = fieldsKey(fields);

    if (key !== (written.current.at(-1) ?? urlFields)) {
      written.current.push(key);
      void navigate({
        replace: true,
        resetScroll: false,
        search: (previous) => ({ ...previous, ...fields, step }),
        to: "/motionTransfer",
      });
    }
  };

  const access = useAccessCode();
  const { release } = access;
  const generate = useGenerate(access.hold);

  // The URL names the step shown, so Back and Forward retrace it.
  useEffect(() => {
    if (draft.step !== step) {
      void navigate({
        replace: true,
        resetScroll: false,
        search: (previous) => ({ ...previous, step }),
        to: "/motionTransfer",
      });
    }
  }, [navigate, draft.step, step]);

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

      const heading = main.current?.querySelector("h1");

      heading?.setAttribute("tabindex", "-1");
      heading?.focus();
    }
  }, [step]);

  const at = (target: WizardStep): MotionTransferDraft => ({ ...draft, step: target });

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

  const motionRow: SlateRow = {
    change: step !== "motion" ? at("motion") : undefined,
    empty: "Not picked yet",
    icon: VideoIcon,
    label: "Motion",
    media: motion ? <ClipStill src={mediaUrl(motion)} /> : undefined,
    value: motionChoice ? (sampleMotion?.title ?? "Your clip") : null,
  };

  const characterRow: SlateRow = {
    change: step === "direct" ? at("character") : undefined,
    empty: step === "motion" ? "Next step" : "Not picked yet",
    icon: UserRoundIcon,
    image: character ? mediaUrl(character.image) : undefined,
    label: "Character",
    value: characterChoice ? (character?.title ?? "Your photo") : null,
  };

  const lookRow: SlateRow = {
    icon: ImageIcon,
    label: "Look",
    value: lookName(direction.prompt),
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

  // What the generation actions get: the picks and the direction as they stand.
  const shot = snapshotDraft({
    character: characterChoice,
    from: draft.from,
    motion: motionChoice,
    ...directionFields(direction),
  });

  const action =
    step === "direct" ? (
      // Keyed apart from Continue: React would otherwise turn the clicked Continue into a
      // submit button before the click's default action runs, and submit the form.
      <GenerationActions draft={shot} formId={formId} key="generate" pending={generate.pending} />
    ) : (
      <Button
        disabled={!picked}
        key="continue"
        onClick={() => void navigate({ search: at(nextStep[step]), to: "/motionTransfer" })}
        type="button"
      >
        <span>{picked ? "Continue" : `Pick a ${step} to continue`}</span>
        {picked && <ArrowRightIcon />}
      </Button>
    );

  const accessNote = sampleTakeId
    ? "Uploads and new renders need an access code. Sample pairs already rendered open without one."
    : "Uploads and new renders need an access code.";

  const note =
    step === "direct" ? "You can leave while it renders." : signedIn ? undefined : accessNote;

  const locked = !signedIn && ((motionChoice && !motion) || (characterChoice && !character));

  return (
    <SitePage category="Video" gap={6} mainRef={main} onAccess={access.unlock} top={6}>
      <MotionTransferHeader steps={steps} />
      <ToolColumns
        aside={
          <ShotSlate
            action={action}
            note={note}
            problems={
              step === "direct" && (
                <GenerateProblems errors={generate.errors} failure={generate.failure} />
              )
            }
            rows={[motionRow, characterRow, lookRow]}
          />
        }
        asideClassName="sticky top-6"
        asideLabel="Your shot"
      >
        <StepIntro title={intros[step].title}>{intros[step].sentence}</StepIntro>
        {locked && (
          <section
            aria-label="Private choices"
            className="flex flex-wrap items-center gap-3 rounded-field border border-warning/40 bg-warning/5 px-5 py-4"
          >
            <LockIcon
              aria-hidden="true"
              className="size-5 shrink-0 text-warning-foreground"
              strokeWidth={1.75}
            />
            <p className="min-w-0 flex-1 basis-60 type-caption text-soft-foreground">
              This link names your own {motionChoice && !motion ? "clip" : "photo"}
              {motionChoice && !motion && characterChoice && !character ? " and photo" : ""}: enter
              the access code to see it here. Generate keeps it and asks for the code too.
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
            character={character}
            characterId={characterChoice}
            characters={characters}
            draft={snapshotDraft({ ...shot, character: undefined })}
            hold={access.hold}
            onPick={(id) => void pickCharacter(id)}
            picker={characterPicker}
            release={release}
            signedIn={signedIn}
          />
        )}
        {step === "direct" && (
          <DirectStep
            characterImage={character ? mediaUrl(character.image) : null}
            characterImageAlt={character?.origin === "generated" ? "AI-generated image" : ""}
            direction={direction}
            directionEditor={directionEditor}
            errors={generate.errors}
            formId={formId}
            onChange={changeDirection}
            onSubmit={() =>
              generate.submit({ character: characterChoice, motion: motionChoice }, direction)
            }
          />
        )}
      </ToolColumns>
      <AccessCodeDialog {...access.dialog} sampleTakeId={sampleTakeId} />
    </SitePage>
  );
}
