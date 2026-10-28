import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { type ComponentType, useEffect, useId, useRef, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Label } from "#/components/ui/label";
import { fetchAngleSets, postAngleSet } from "#/features/angles/angles-client";
import {
  type AngleSetList,
  type AngleView,
  angleViews,
  viewLabels,
} from "#/features/angles/contracts";
import type { PickableCharacter } from "#/features/characters";
import { type CharacterPickerProps, snapshotDraft } from "#/features/motionTransfer/api";
import { AccessCodeDialog, AccessStatus } from "#/shared/components/access-code-dialog";
import { Hud, PageGlow } from "#/shared/components/brand";
import { SiteHeader } from "#/shared/components/site";
import { useAccessCode } from "#/shared/use-access-code";

/** What the page needs of Motion Transfer's selection data (`loadSelection`). */
export type AnglesSelection = {
  character: PickableCharacter | null;
  characters: PickableCharacter[];
  signedIn: boolean;
};

// The picker's links carry no Motion Transfer shot from here.
const noShot = snapshotDraft({});

const viewHints: Record<AngleView, string> = {
  "close-up": "Head and shoulders, re-rendered closer",
  front: "Facing the camera",
  profile: "Seen from the side",
  "three-quarter": "Turned about 45°",
};

/** The workspace's latest sets, each a link to its page. */
function RecentSets() {
  const [list, setList] = useState<AngleSetList["sets"] | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void fetchAngleSets(controller.signal).then((result) => {
      if (!controller.signal.aborted && "data" in result) {
        setList(result.data.sets);
      }
    });

    return () => controller.abort();
  }, []);

  if (!list?.length) {
    return null;
  }

  return (
    <section aria-labelledby="recent-sets" className="flex flex-col gap-3">
      <h2 className="font-display text-2xl font-semibold" id="recent-sets">
        Recent angle sets
      </h2>
      <ul className="flex flex-col divide-y rounded-2xl border">
        {list.map((set) => (
          <li key={set.id}>
            <Link
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-foreground/4"
              params={{ angleSetId: set.id }}
              to="/angles/$angleSetId"
            >
              <span className="font-medium">{set.character?.title ?? "Untitled character"}</span>
              <span className="flex flex-wrap gap-1.5">
                {set.views.map(({ status, view }) => (
                  <Badge key={view} variant={status === "done" ? "brand" : "default"}>
                    {viewLabels[view]} · {status}
                  </Badge>
                ))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Shots & Angles at `/angles`: pick a character (the composer's `characterPicker`: the library,
 * an upload with likeness consent, the samples), choose the camera angles, and Generate, which
 * admits one generation per view as an angle set (`POST /api/angle-sets`, one request key per
 * request so a lost answer or a second click admits it once) and opens it at `/angles/:id`. The
 * picked character lives in the URL (`characterId`, changed through `onPick`).
 */
export function AnglesPage({
  characterId,
  characterPicker: CharacterPicker,
  onPick,
  selection,
}: {
  characterId: string | undefined;
  characterPicker: ComponentType<CharacterPickerProps>;
  onPick: (characterId: string | undefined) => void;
  selection: AnglesSelection;
}) {
  const id = useId();
  const navigate = useNavigate();
  const access = useAccessCode();
  const [views, setViews] = useState<AngleView[]>([...angleViews]);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // One key per request: kept until the set is admitted, so asking again is the same request.
  const requestKey = useRef<string | null>(null);

  function toggle(view: AngleView, on: boolean) {
    requestKey.current = null;
    setViews((current) =>
      angleViews.filter((each) => (each === view ? on : current.includes(each))),
    );
  }

  async function generate() {
    if (!characterId) {
      setProblem("Pick a character first.");

      return;
    }

    if (views.length === 0) {
      setProblem("Choose at least one view.");

      return;
    }

    requestKey.current ??= crypto.randomUUID();
    setPending(true);
    setProblem(null);

    const result = await postAngleSet(characterId, views, requestKey.current);

    setPending(false);

    if ("data" in result) {
      requestKey.current = null;
      void navigate({ params: { angleSetId: result.data.id }, to: "/angles/$angleSetId" });
    } else if (result.refusal.reason === "access_required") {
      access.hold("angles-generate", "generate", () => void generate());
    } else {
      setProblem(result.refusal.message);
    }
  }

  return (
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <SiteHeader category="Image">
        <AccessStatus onOpen={access.unlock} signedIn={selection.signedIn} />
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-330 flex-col gap-10 px-4 py-8 sm:px-8 sm:py-12">
        <div className="flex flex-col gap-3">
          <Hud>Shots & Angles · Qwen-Image-Edit-2511 · Multiple-Angles LoRA</Hud>
          <h1 className="font-display text-4xl leading-none font-bold tracking-display sm:text-5xl">
            Shots & Angles
          </h1>
          <p className="max-w-2xl text-soft-foreground">
            See one character from other camera angles: front, three-quarter, profile and a
            close-up, each rendered anew from the character&apos;s image, not cropped.
          </p>
        </div>

        <section aria-labelledby={`${id}-character`} className="flex flex-col gap-4">
          <h2 className="font-display text-2xl font-semibold" id={`${id}-character`}>
            1 · Pick a character
          </h2>
          <p className="text-sm text-soft-foreground">
            A full-body image turns best. Pick a sample, one from the library, or upload a photo you
            have the right to use.
          </p>
          <CharacterPicker
            character={selection.character}
            characterId={characterId}
            characters={selection.characters}
            draft={noShot}
            hold={access.hold}
            onPick={(next) => {
              requestKey.current = null;
              setProblem(null);
              onPick(next);
            }}
            release={access.release}
            signedIn={selection.signedIn}
          />
        </section>

        <form
          aria-labelledby={`${id}-views`}
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void generate();
          }}
        >
          <h2 className="font-display text-2xl font-semibold" id={`${id}-views`}>
            2 · Choose the views
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {angleViews.map((view) => (
              <li className="flex items-start gap-3 rounded-xl border p-4" key={view}>
                <Checkbox
                  aria-describedby={`${id}-${view}-hint`}
                  checked={views.includes(view)}
                  id={`${id}-${view}`}
                  onCheckedChange={(checked) => toggle(view, checked === true)}
                />
                <span className="flex flex-col gap-1">
                  <Label htmlFor={`${id}-${view}`}>{viewLabels[view]}</Label>
                  <span className="text-sm text-muted-foreground" id={`${id}-${view}-hint`}>
                    {viewHints[view]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            Each view is its own generation (about 30 s on Comfy Cloud) with one seed for the set. A
            turn shows one side of the character; the model chooses which.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Button disabled={pending} size="lg" type="submit" variant="photon">
              {pending
                ? "Starting…"
                : `Generate ${views.length} ${views.length === 1 ? "view" : "views"}`}
              <ArrowRightIcon />
            </Button>
            {problem && (
              <p className="text-sm text-destructive-foreground" role="alert">
                {problem}
              </p>
            )}
          </div>
        </form>

        <RecentSets />
      </main>
      <AccessCodeDialog {...access.dialog} />
    </div>
  );
}
