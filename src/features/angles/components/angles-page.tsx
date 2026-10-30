import { Link, useNavigate } from "@tanstack/react-router";
import { CameraIcon, SparklesIcon, UserIcon } from "lucide-react";
import { type ComponentType, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { postAngleSet } from "#/features/angles/angles-client";
import closeUp from "#/features/angles/assets/view-close-up.webp";
import front from "#/features/angles/assets/view-front.webp";
import profile from "#/features/angles/assets/view-profile.webp";
import threeQuarter from "#/features/angles/assets/view-three-quarter.webp";
import {
  type AngleSetList,
  type AngleView,
  angleViews,
  viewLabels,
} from "#/features/angles/contracts";
import type { PickableCharacter } from "#/features/characters";
import { type CharacterPickerProps, snapshotDraft } from "#/features/motionTransfer/api";
import { AccessCodeDialog } from "#/shared/components/access-code-dialog";
import { PageHeading } from "#/shared/components/page-heading";
import { PictureTile } from "#/shared/components/picture-tile";
import { SitePage } from "#/shared/components/site";
import { SummaryPanel, SummaryRow } from "#/shared/components/summary-panel";
import { ToolColumns, ToolSection } from "#/shared/components/tool-layout";
import { mediaUrl } from "#/shared/media";
import { useAccessCode } from "#/shared/use-access-code";

/** What the page needs of Motion Transfer's selection data (`loadSelection`). */
export type AnglesSelection = {
  character: PickableCharacter | null;
  characters: PickableCharacter[];
  signedIn: boolean;
};

// The picker's links carry no Motion Transfer shot from here.
const noShot = snapshotDraft({});

// Real renders of the sample character Maya, from this workflow's gate
// (`docs/feature-evidence/shots-and-angles`): what each view does, whoever is picked.
const viewExamples: Record<AngleView, { hint: string; src: string }> = {
  "close-up": { hint: "Head and shoulders, re-rendered closer", src: closeUp },
  front: { hint: "Facing the camera", src: front },
  profile: { hint: "Seen from the side", src: profile },
  "three-quarter": { hint: "Turned about 45°", src: threeQuarter },
};

/** What a set's views have come to, in a few words. */
function setProgress(views: AngleSetList["sets"][number]["views"]) {
  const done = views.filter(({ status }) => status === "done").length;
  const stopped = views.filter(({ status }) => status === "failed" || status === "cancelled");

  if (done === views.length) {
    return `${done} ${done === 1 ? "view" : "views"}`;
  }

  return `${done} of ${views.length} done${stopped.length ? `, ${stopped.length} failed` : ""}`;
}

/** The workspace's latest sets, each a link to its page. */
function RecentSets({ sets }: { sets: AngleSetList["sets"] }) {
  if (sets.length === 0) {
    return null;
  }

  return (
    // Beside the aside on a wide screen this stays in the form's column: 340 of aside + 40 of gap.
    <div className="lg:pr-95">
      <ToolSection title="Earlier sets">
        <ul className="grid grid-fill-80 gap-2.5">
          {sets.map((set) => {
            const name =
              set.character?.title ??
              (set.character?.origin === "upload" ? "Untitled photo" : "Untitled character");

            return (
              <li className="min-w-0" key={set.id}>
                <Link
                  className="flex min-w-0 items-center gap-3.5 rounded-xl border bg-card/72 py-2.5 pr-4 pl-2.5 transition-colors hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  params={{ angleSetId: set.id }}
                  to="/angles/$angleSetId"
                >
                  <span className="relative block h-14 w-11 shrink-0 overflow-hidden rounded-thumb bg-screen shadow-hairline">
                    {set.character && (
                      <img
                        alt=""
                        className="absolute inset-0 size-full object-cover"
                        src={mediaUrl(set.character.image)}
                      />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate type-label text-foreground" title={name}>
                      {name}
                    </span>
                    <span
                      className="truncate type-caption text-muted-foreground"
                      title={set.views
                        .map(({ status, view }) => `${viewLabels[view]}: ${status}`)
                        .join(", ")}
                    >
                      {setProgress(set.views)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </ToolSection>
    </div>
  );
}

/**
 * Shots & Angles at `/angles`: pick a character (the composer's `characterPicker`: the library,
 * an upload with likeness consent, the samples), choose the camera angles, and Generate, which
 * admits one generation per view as an angle set (`POST /api/angle-sets`, one request key per
 * request so a lost answer or a second click admits it once) and opens it at `/angles/:id`. The
 * picked character lives in the URL (`characterId`, changed through `onPick`). The view tiles show
 * what a view does on one sample character: no view of the picked one exists until its set renders.
 * `recentSets` come with the page, so its first paint is its final height.
 */
export function AnglesPage({
  characterId,
  characterPicker: CharacterPicker,
  onPick,
  recentSets,
  selection,
}: {
  characterId: string | undefined;
  characterPicker: ComponentType<CharacterPickerProps>;
  onPick: (characterId: string | undefined) => void;
  recentSets: AngleSetList["sets"];
  selection: AnglesSelection;
}) {
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

  const character = characterId ? selection.character : null;
  const [firstView] = views;

  return (
    <SitePage category="Image" gap={10} onAccess={access.unlock} top={10}>
      <ToolColumns
        asideClassName="sticky top-6"
        asideLabel="Your set"
        aside={
          <div className="flex flex-col gap-2">
            <SummaryPanel
              actions={
                <Button
                  disabled={pending || views.length === 0}
                  onClick={() => void generate()}
                  variant="photon"
                >
                  <SparklesIcon aria-hidden="true" />
                  <span>
                    {pending
                      ? "Starting…"
                      : `Generate ${views.length} ${views.length === 1 ? "view" : "views"}`}
                  </span>
                </Button>
              }
              label="Your set"
            >
              <SummaryRow
                icon={<UserIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />}
                image={character ? mediaUrl(character.image) : undefined}
                label="Character"
                placeholder="Pick a character"
                value={characterId ? (character?.title ?? "Your character") : null}
              />
              <SummaryRow
                icon={<CameraIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />}
                image={firstView && viewExamples[firstView].src}
                label="Views"
                placeholder="Choose at least one"
                value={views
                  .map((view, index) =>
                    index === 0 ? viewLabels[view] : viewLabels[view].toLowerCase(),
                  )
                  .join(", ")}
              />
            </SummaryPanel>
            {/* Always there, under the card: a refusal takes this line and moves nothing. */}
            <p
              className="min-h-5 text-center type-caption text-pretty wrap-anywhere text-destructive-foreground"
              role="alert"
            >
              {problem}
            </p>
          </div>
        }
      >
        <PageHeading subtitle="See one character from every side." title="Shots & Angles" />

        <CharacterPicker
          character={selection.character}
          characterId={characterId}
          characters={selection.characters}
          draft={noShot}
          hold={access.hold}
          number="01"
          onPick={(next) => {
            requestKey.current = null;
            setProblem(null);
            onPick(next);
          }}
          release={access.release}
          signedIn={selection.signedIn}
        />

        <ToolSection number="02" title="Views">
          <div
            aria-label="Views"
            className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-3.5"
            role="group"
          >
            {angleViews.map((view) => (
              <PictureTile
                alt={`${viewLabels[view]} example, AI-generated image`}
                aspect="aspect-9/14"
                caption={viewLabels[view]}
                key={view}
                onClick={() => toggle(view, !views.includes(view))}
                position="object-top"
                pressed={views.includes(view)}
                src={viewExamples[view].src}
                strong
                title={viewExamples[view].hint}
              />
            ))}
          </div>
        </ToolSection>
      </ToolColumns>

      <RecentSets sets={recentSets} />

      <AccessCodeDialog {...access.dialog} />
    </SitePage>
  );
}
