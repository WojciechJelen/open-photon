import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  readCaptionRecipe,
  readImageRecipe,
  requestCaption,
  requestImage,
  retryGeneration,
  saveCharacter,
} from "#/features/characterBuilder/builder-client";
import { controlsOf, seedOf, withDescribed } from "#/features/characterBuilder/builder-form";
import {
  type BuilderForm,
  emptyForm,
  recallForm,
  rememberForm,
  requestKeyFor,
} from "#/features/characterBuilder/builder-memory";
import {
  type BuilderSearch,
  type BuilderStep,
  shownStep,
} from "#/features/characterBuilder/builder-search";
import {
  type CaptionField,
  CaptionStep,
} from "#/features/characterBuilder/components/caption-step";
import {
  type DescribeField,
  DescribeStep,
} from "#/features/characterBuilder/components/describe-step";
import { ImageStep } from "#/features/characterBuilder/components/image-step";
import { RefusalNotice } from "#/features/characterBuilder/components/refusal-notice";
import {
  characterCaptionInputSchema,
  type CharacterGenerationInput,
  characterGenerationInputSchema,
} from "#/features/characterBuilder/contracts";
import type { CharacterSummary } from "#/features/characters";
import { AccessCodeDialog, AccessStatus } from "#/shared/components/access-code-dialog";
import { PageGlow } from "#/shared/components/brand";
import { SiteHeader } from "#/shared/components/site";
import type { GenerationReceipt } from "#/shared/contracts";
import type { Refusal } from "#/shared/requests";
import { useAccessCode } from "#/shared/use-access-code";
import { useRequestSignal } from "#/shared/use-request-signal";

type Pending = "another" | "enhance" | "generate" | "retry" | "save";

/** A refused request, and how to send it again: the same request, or as a new one. */
type Refused = { fresh?: () => void; refusal: Refusal; retry: () => void };

const stepLabels: Record<BuilderStep, string> = {
  caption: "Caption",
  describe: "Describe",
  image: "Image",
};

/**
 * `/characters/new`: describe a character, enhance the description into a caption, edit it,
 * render it with FLUX 3 Image Klein, then save it to the workspace library and animate it.
 *
 * The URL holds the generations (`builder-search.ts`), so a reload follows them instead of
 * starting new ones; the tab's storage holds what is typed but not sent, and the request key of
 * each request (`requestKeyFor`), so sending the same request again (a double click, a resend
 * after a lost answer) returns the generation the first one made. A deliberate new attempt
 * ("Another image", a new enhancement after one whose status is unknown) is a new request.
 * Anything that needs the access code asks for it and then carries on.
 */
export function CharacterBuilder({ search }: { search: BuilderSearch }) {
  const navigate = useNavigate({ from: "/characters/new" });
  const access = useAccessCode();
  const nextSignal = useRequestSignal();
  const step = shownStep(search);

  const [form, setForm] = useState<BuilderForm>(emptyForm);
  const [recalled, setRecalled] = useState(false);
  const [describeErrors, setDescribeErrors] = useState<DescribeField[]>([]);
  const [captionErrors, setCaptionErrors] = useState<CaptionField[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [refused, setRefused] = useState<Refused | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [savedCharacter, setSavedCharacter] = useState<CharacterSummary | null>(null);

  // The form this tab typed before a reload; after that, every edit is kept.
  useEffect(() => {
    setForm(recallForm() ?? emptyForm);
    setRecalled(true);
  }, []);

  useEffect(() => {
    if (recalled) {
      rememberForm(form);
    }
  }, [form, recalled]);

  // A caption opened without its description (another tab, a shared link): the description and
  // controls it was made from, from its recipe.
  const describedFrom = useRef<string | null>(null);

  useEffect(() => {
    if (!recalled || !search.caption || form.description !== "") {
      return;
    }

    if (describedFrom.current === search.caption) {
      return;
    }

    describedFrom.current = search.caption;

    void readCaptionRecipe(search.caption).then((answer) => {
      if ("data" in answer) {
        setForm((current) =>
          current.description === "" ? withDescribed(current, answer.data) : current,
        );
      }
    });
  }, [recalled, search.caption, form.description]);

  // The new screen's heading takes focus, never on the first render.
  const shown = useRef(step);

  useEffect(() => {
    if (shown.current !== step) {
      shown.current = step;
      document.querySelector<HTMLElement>("[data-step-heading]")?.focus();
      setRefused(null);
    }
  }, [step]);

  function go(next: Partial<BuilderSearch>) {
    void navigate({ search: (previous) => ({ ...previous, ...next }) });
  }

  /**
   * Sends one request and acts on its answer: `onAnswer` with the receipt, or the refusal shown
   * with its recovery (`again` sends the same request; `fresh` a new one). One that needs the
   * access code waits for it, then is sent again with the same key.
   */
  async function send<T>(
    kind: Pending,
    request: () => Promise<{ data: T } | { refusal: Refusal }>,
    onAnswer: (data: T) => void,
    fresh?: () => void,
  ) {
    // Not passed to the request: one that reached the server finishes there; leaving the page
    // only drops what this page does with its answer.
    const signal = nextSignal();
    const again = () => void send(kind, request, onAnswer, fresh);

    setPending(kind);
    setRefused(null);

    const answer = await request();

    if (signal.aborted) {
      return;
    }

    setPending(null);

    if ("data" in answer) {
      onAnswer(answer.data);
    } else if (answer.refusal.reason === "access_required") {
      setSignedIn(false);
      access.hold(kind, kind === "save" ? "unlock" : "generate", again);
    } else {
      setRefused({ fresh, refusal: answer.refusal, retry: again });
    }
  }

  function enhance(fresh: boolean) {
    const parsed = characterCaptionInputSchema.safeParse({
      controls: controlsOf(form),
      description: form.description,
    });

    if (!parsed.success) {
      setDescribeErrors(
        [...new Set(parsed.error.issues.map(({ path }) => path.at(-1)))].filter(
          (field): field is DescribeField =>
            field === "description" || field === "appearance" || field === "outfit",
        ),
      );
      go({ step: "describe" });

      return;
    }

    setDescribeErrors([]);

    const key = requestKeyFor("caption", parsed.data, fresh);

    void send(
      "enhance",
      () => requestCaption(parsed.data, key),
      (receipt: GenerationReceipt) => {
        setForm((current) => ({ ...current, caption: null, captionFor: null }));
        go({ caption: receipt.id, image: undefined, saved: undefined, step: "caption" });
      },
      () => enhance(true),
    );
  }

  function generate(caption: string) {
    const seed = seedOf(form);

    // With an enhancement, the server takes the description and controls from it.
    const source: NonNullable<CharacterGenerationInput["source"]> = search.caption
      ? { caption_generation_id: search.caption }
      : { controls: controlsOf(form) };

    if (!search.caption && form.description.trim() !== "") {
      source.description = form.description;
    }

    // The caption goes as typed: what the visitor approved is what is rendered.
    const input: CharacterGenerationInput = { caption, source };

    if (seed !== undefined) {
      input.seed = seed;
    }

    const parsed = characterGenerationInputSchema.safeParse(input);

    if (!parsed.success) {
      const fields = new Set(parsed.error.issues.map(({ path }) => path[0]));

      setCaptionErrors((["caption", "seed"] as const).filter((field) => fields.has(field)));

      if (!fields.has("caption") && !fields.has("seed")) {
        setRefused({
          refusal: { message: "The description or controls are not valid. Edit the description." },
          retry: () => go({ step: "describe" }),
        });
      }

      return;
    }

    setCaptionErrors([]);
    sendImage(input, false);
  }

  /**
   * Starts the image `input` describes: the same request again (`fresh` false) finds the image
   * it made; a fresh one renders anew.
   */
  function sendImage(input: CharacterGenerationInput, fresh: boolean) {
    const key = requestKeyFor("image", input, fresh);

    void send(
      fresh ? "another" : "generate",
      () => requestImage(input, key),
      (receipt: GenerationReceipt) => {
        setSavedCharacter(null);
        go({ image: receipt.id, saved: undefined, step: "image" });
      },
      () => sendImage(input, true),
    );
  }

  function retry(generationId: string, kind: "caption" | "image") {
    void send(
      "retry",
      () => retryGeneration(generationId),
      (receipt: GenerationReceipt) =>
        go(kind === "caption" ? { caption: receipt.id } : { image: receipt.id, saved: undefined }),
    );
  }

  async function another() {
    const image = search.image;

    if (!image) {
      return;
    }

    // The shown image's own caption and source, exactly, with a random seed: a new image.
    const answer = await readImageRecipe(image);

    if ("refusal" in answer) {
      setRefused({ refusal: answer.refusal, retry: () => void another() });

      return;
    }

    const { caption, source } = answer.data;
    const from: NonNullable<CharacterGenerationInput["source"]> = {};

    if (source.enhancement) {
      from.caption_generation_id = source.enhancement.generation_id;
    } else {
      from.description = source.description ?? undefined;
      from.controls = source.controls ?? undefined;
    }

    sendImage({ caption, source: from }, true);
  }

  function save(generationId: string, title: string | undefined) {
    void send(
      "save",
      () => saveCharacter(generationId, title),
      (character: CharacterSummary) => {
        setSavedCharacter(character);
        go({ saved: character.id });
      },
    );
  }

  const notice = refused && (
    <RefusalNotice
      onFresh={refused.fresh}
      onRetry={refused.retry}
      onUnlock={access.unlock}
      refusal={refused.refusal}
    />
  );

  const unlockThen = (resume: () => void) => {
    setSignedIn(false);
    access.hold("load", "unlock", resume);
  };

  const reached: Record<BuilderStep, boolean> = {
    caption: search.caption !== undefined || search.image !== undefined,
    describe: true,
    image: search.image !== undefined,
  };

  return (
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <SiteHeader>
        <AccessStatus onOpen={access.unlock} signedIn={signedIn} />
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pt-6 pb-18 sm:px-8 lg:pt-10">
        <nav aria-label="Character builder steps">
          <ol className="flex flex-wrap items-center gap-2 sm:gap-3">
            {(["describe", "caption", "image"] as const).map((id, index) => {
              const state =
                id === step
                  ? "current"
                  : index < ["describe", "caption", "image"].indexOf(step)
                    ? "done"
                    : "todo";

              return (
                <li className="flex items-center gap-2 sm:gap-3" key={id}>
                  {index > 0 && <span aria-hidden="true" className="h-px w-4 bg-border sm:w-8" />}
                  <button
                    aria-current={state === "current" ? "step" : undefined}
                    className={cn(
                      "inline-flex min-h-11 items-center gap-2 rounded-full px-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default",
                      state === "todo" ? "text-muted-foreground" : "text-foreground",
                    )}
                    disabled={state === "current" || !reached[id]}
                    onClick={() => go({ step: id })}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-7 place-items-center rounded-full border border-input font-mono text-xs",
                        state === "done" && "border-brand/50 bg-brand/16 text-brand",
                        state === "current" &&
                          "border-transparent bg-linear-100 from-brand via-brand-mid to-brand-2 font-semibold text-primary-foreground",
                      )}
                    >
                      {state === "done" ? (
                        <CheckIcon className="size-3.5" strokeWidth={3} />
                      ) : (
                        index + 1
                      )}
                    </span>
                    {/* Below `sm` only the current step is named; every step stays labelled. */}
                    <span className={state === "current" ? undefined : "sr-only sm:not-sr-only"}>
                      {stepLabels[id]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {step === "describe" && (
          <DescribeStep
            errors={describeErrors}
            form={form}
            notice={notice}
            onChange={setForm}
            onEnhance={() => enhance(false)}
            onWriteOwn={() => go({ caption: undefined, step: "caption" })}
            pending={pending === "enhance"}
          />
        )}
        {step === "caption" && (
          <CaptionStep
            captionId={search.caption}
            errors={captionErrors}
            form={form}
            notice={notice}
            onBack={() => go({ step: "describe" })}
            onChange={setForm}
            onEnhance={enhance}
            onGenerate={generate}
            onRetry={(id) => retry(id, "caption")}
            onUnlock={unlockThen}
            pending={
              pending === "enhance" || pending === "generate" || pending === "retry"
                ? pending
                : null
            }
          />
        )}
        {step === "image" && search.image && (
          <ImageStep
            draft={search.draft}
            imageId={search.image}
            notice={notice}
            onAnother={() => void another()}
            onBack={() =>
              go({ caption: undefined, image: undefined, saved: undefined, step: "describe" })
            }
            onEditCaption={() => go({ step: "caption" })}
            onRetry={(id) => retry(id, "image")}
            onSave={save}
            onUnlock={unlockThen}
            pending={
              pending === "another" || pending === "retry" || pending === "save" ? pending : null
            }
            saved={
              search.saved
                ? {
                    character: savedCharacter?.id === search.saved ? savedCharacter : null,
                    id: search.saved,
                  }
                : null
            }
          />
        )}
      </main>
      <AccessCodeDialog
        {...access.dialog}
        onSignedIn={() => {
          setSignedIn(true);
          access.dialog.onSignedIn();
        }}
      />
    </div>
  );
}
