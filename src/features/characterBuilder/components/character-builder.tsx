import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { CheckIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import {
  readCaptionRecipe,
  readImageRecipe,
  requestCaption,
  requestImage,
  saveCharacter,
} from "#/features/characterBuilder/builder-client";
import {
  type CaptionSource,
  captionRequest,
  controlsOf,
  imageRequest,
  seedOf,
  withDescribed,
} from "#/features/characterBuilder/builder-form";
import {
  attemptKeyFor,
  type BuilderForm,
  emptyForm,
  keysPersist,
  recallForm,
  rememberForm,
  requestKeyFor,
  settleAttempt,
} from "#/features/characterBuilder/builder-memory";
import {
  type BuilderSearch,
  type BuilderStep,
  shownStep,
} from "#/features/characterBuilder/builder-search";
import {
  type CaptionField,
  CaptionStep,
  imageSource,
} from "#/features/characterBuilder/components/caption-step";
import {
  type DescribeField,
  DescribeStep,
} from "#/features/characterBuilder/components/describe-step";
import { ImageStep } from "#/features/characterBuilder/components/image-step";
import { RefusalNotice } from "#/features/characterBuilder/components/refusal-notice";
import type { CharacterSummary } from "#/features/characters";
import { AccessCodeDialog, AccessStatus } from "#/shared/components/access-code-dialog";
import { PageGlow } from "#/shared/components/brand";
import { SiteHeader } from "#/shared/components/site";
import type { Refusal } from "#/shared/requests";
import { useAccessCode } from "#/shared/use-access-code";
import { useRequestSignal } from "#/shared/use-request-signal";

/** The action under way; one at a time. `again`: a new attempt of a shown caption or image. */
type Pending = "again" | "enhance" | "generate" | "save";

/** A refused action, and how to send it again: the same request, or as a new one. */
type Refused = { fresh?: () => void; refusal: Refusal; retry: () => void };

type Answer<T> = { data: T } | { refusal: Refusal };

const stepLabels: Record<BuilderStep, string> = {
  caption: "Caption",
  describe: "Describe",
  image: "Image",
};

const describeFields = new Set<PropertyKey>(["appearance", "description", "outfit"]);

/**
 * `/characters/new`: describe a character, enhance the description into a caption, edit it,
 * render it with FLUX 3 Image Klein, then save it to the workspace library and animate it.
 *
 * Nothing is ever paid for twice by accident:
 * - one action at a time: an action takes the page's lock before its first `await` and keeps
 *   every action disabled until it is answered (`act`);
 * - every generation request carries a request key (`builder-memory.ts`): Enhance and Generate
 *   send the same key for the same request, so a double click, a resend after a lost answer or
 *   a reload answers with the generation the first one made; a new attempt of a shown caption
 *   or image ("Try again", "Another image") has one key until an answer names its generation;
 * - the URL holds the generations (`builder-search.ts`), so a reload follows them.
 * The tab's storage keeps what is typed but not sent. Anything that needs the access code asks
 * for it and then carries on.
 */
export function CharacterBuilder({
  search,
  signedIn: hasSession,
}: {
  search: BuilderSearch;
  /** Whether the visitor had an access session when the page loaded (`loadBuilderAccess`). */
  signedIn: boolean;
}) {
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
  const [signedIn, setSignedIn] = useState(hasSession);
  const [savedCharacter, setSavedCharacter] = useState<CharacterSummary | null>(null);
  const [persistent, setPersistent] = useState(true);
  const busy = useRef(false);

  // The form this tab typed before a reload; after that, every edit is kept.
  useEffect(() => {
    setForm(recallForm() ?? emptyForm);
    setRecalled(true);
    setPersistent(keysPersist());
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
    if (!recalled || !search.caption || search.image || form.description !== "") {
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
  }, [recalled, search.caption, search.image, form.description]);

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
   * "Start over": a blank description, controls, seed and caption, in the form and in the tab's
   * storage, and the describe screen with no generation in the URL; the Motion Transfer draft the
   * visitor came with stays. Nothing stored is touched: saved characters and generations remain,
   * and a request already sent still answers a repeat with its first generation.
   */
  async function startOver() {
    if (busy.current) {
      return;
    }

    // The URL first: with its caption still in it, a blank description would be filled again
    // from that caption's recipe (above).
    await navigate({ search: { draft: search.draft } });
    setForm(emptyForm);
    setDescribeErrors([]);
    setCaptionErrors([]);
    setRefused(null);
    setSavedCharacter(null);
  }

  /**
   * Runs one action: it takes the page's lock at once, before anything is awaited, so a second
   * click (or another action) while it runs does nothing, and the buttons say so (`pending`).
   */
  async function act(kind: Pending, work: (signal: AbortSignal) => Promise<void>) {
    if (busy.current) {
      return;
    }

    busy.current = true;
    setPending(kind);
    setRefused(null);

    try {
      // Not passed to the requests: one that reached the server finishes there; leaving the page
      // only drops what this page does with its answer.
      await work(nextSignal());
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  /**
   * A refusal, and its recovery: the access code asked for, then `again`; or shown, with
   * `again` (the same request, its same key) and `fresh` (a new request).
   */
  function refuse(kind: Pending, refusal: Refusal, again: () => void, fresh?: () => void) {
    if (refusal.reason === "access_required") {
      setSignedIn(false);
      access.hold(kind, kind === "save" ? "unlock" : "generate", again);
    } else {
      setRefused({ fresh, refusal, retry: again });
    }
  }

  /** The answer of a request, unless the page has left it: its data, or `null` once refused. */
  function settle<T>(
    signal: AbortSignal,
    kind: Pending,
    answer: Answer<T>,
    again: () => void,
    fresh?: () => void,
  ) {
    if (signal.aborted) {
      return null;
    }

    if ("refusal" in answer) {
      refuse(kind, answer.refusal, again, fresh);

      return null;
    }

    return answer.data;
  }

  function enhance(fresh = false) {
    const parsed = captionRequest({ controls: controlsOf(form), description: form.description });

    if (!parsed.success) {
      setDescribeErrors(
        [...new Set(parsed.error.issues.map(({ path }) => path.at(-1)))].filter(
          (field): field is DescribeField => describeFields.has(field ?? ""),
        ),
      );
      go({ step: "describe" });

      return;
    }

    setDescribeErrors([]);

    const input = parsed.data;

    void act("enhance", async (signal) => {
      const answer = await requestCaption(input, requestKeyFor("caption", input, fresh));

      const receipt = settle(
        signal,
        "enhance",
        answer,
        () => enhance(),
        () => enhance(true),
      );

      if (receipt) {
        go({ caption: receipt.id, image: undefined, saved: undefined, step: "caption" });
      }
    });
  }

  function generate(caption: string, source: CaptionSource, fresh = false) {
    // The caption goes exactly as typed: what the visitor approved is what is rendered.
    const parsed = imageRequest(caption, source, seedOf(form));

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

    const input = parsed.data;

    void act("generate", async (signal) => {
      const answer = await requestImage(input, requestKeyFor("image", input, fresh));

      const receipt = settle(
        signal,
        "generate",
        answer,
        () => generate(caption, source),
        () => generate(caption, source, true),
      );

      if (receipt) {
        setSavedCharacter(null);
        go({ image: receipt.id, saved: undefined, step: "image" });
      }
    });
  }

  /**
   * A new enhancement of the description and controls `captionId` was made from (it failed or
   * was cancelled; an `unknown` one is never sent again): its own request key until answered.
   */
  function captionAgain(captionId: string, fresh = false) {
    const again = () => captionAgain(captionId);

    void act("again", async (signal) => {
      const recipe = settle(signal, "again", await readCaptionRecipe(captionId), again);
      const parsed = recipe && captionRequest(recipe);

      if (!parsed?.success) {
        if (parsed) {
          refuse(
            "again",
            { message: "This caption can't be sent again. Edit the description." },
            () => go({ step: "describe" }),
          );
        }

        return;
      }

      const action = `caption-again:${captionId}`;
      const key = attemptKeyFor(action, parsed.data, fresh);
      const answer = await requestCaption(parsed.data, key);

      const receipt = settle(signal, "again", answer, again, () => captionAgain(captionId, true));

      if (receipt) {
        settleAttempt(action, "caption");
        go({ caption: receipt.id, image: undefined, saved: undefined, step: "caption" });
      }
    });
  }

  /**
   * A new image of the caption and source `imageId` was made from, with a seed the server draws
   * ("Another image, same caption", or a failed image tried again): its own request key until it
   * is answered.
   */
  function imageAgain(imageId: string, fresh = false) {
    const again = () => imageAgain(imageId);

    void act("again", async (signal) => {
      const recipe = settle(signal, "again", await readImageRecipe(imageId), again);
      const parsed = recipe && imageRequest(recipe.caption, imageSource(recipe), undefined);

      if (!parsed?.success) {
        if (parsed) {
          refuse("again", { message: "This image can't be made again. Edit the caption." }, () =>
            go({ step: "caption" }),
          );
        }

        return;
      }

      const action = `image-again:${imageId}`;
      const key = attemptKeyFor(action, parsed.data, fresh);
      const answer = await requestImage(parsed.data, key);
      const receipt = settle(signal, "again", answer, again, () => imageAgain(imageId, true));

      if (receipt) {
        settleAttempt(action, "image");
        setSavedCharacter(null);
        go({ image: receipt.id, saved: undefined, step: "image" });
      }
    });
  }

  function save(generationId: string, title: string | undefined) {
    void act("save", async (signal) => {
      const character = settle(signal, "save", await saveCharacter(generationId, title), () =>
        save(generationId, title),
      );

      if (character) {
        setSavedCharacter(character);
        go({ saved: character.id });
      }
    });
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
        <div className="flex flex-wrap items-center justify-between gap-3">
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
          <Button
            disabled={pending !== null}
            onClick={() => void startOver()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RotateCcwIcon aria-hidden="true" />
            Start over
          </Button>
        </div>

        {!persistent && (
          <p className="text-sm text-soft-foreground" role="note">
            This browser does not let the page remember its requests across a reload. Clicking again
            is safe; after a reload, check a request's result before sending it again.
          </p>
        )}

        {step === "describe" && (
          <DescribeStep
            errors={describeErrors}
            form={form}
            notice={notice}
            onChange={setForm}
            onEnhance={() => enhance()}
            onWriteOwn={() => go({ caption: undefined, image: undefined, step: "caption" })}
            pending={pending !== null}
          />
        )}
        {step === "caption" && (
          <CaptionStep
            captionId={search.caption}
            errors={captionErrors}
            form={form}
            imageId={search.image}
            notice={notice}
            onBack={() => go({ step: "describe" })}
            onChange={setForm}
            onEnhance={() => enhance()}
            onGenerate={(caption, source) => generate(caption, source)}
            onOpenImage={() => go({ step: "image" })}
            onTryAgain={(id) => captionAgain(id)}
            onUnlock={unlockThen}
            pending={pending}
          />
        )}
        {step === "image" && search.image && (
          <ImageStep
            draft={search.draft}
            imageId={search.image}
            notice={notice}
            onBack={() =>
              go({ caption: undefined, image: undefined, saved: undefined, step: "describe" })
            }
            onEditCaption={() => go({ step: "caption" })}
            onSave={save}
            onTryAgain={(id) => imageAgain(id)}
            onUnlock={unlockThen}
            pending={pending}
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
