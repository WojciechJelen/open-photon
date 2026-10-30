import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { CheckIcon, SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import advertising from "#/features/productStudio/assets/preset-advertising.webp";
import lifestyle from "#/features/productStudio/assets/preset-lifestyle.webp";
import packshot from "#/features/productStudio/assets/preset-packshot.webp";
import { PhotoField, type ProductPhoto } from "#/features/productStudio/components/photo-field";
import { ShootView } from "#/features/productStudio/components/shoot-view";
import {
  createShootInputSchema,
  formatDetails,
  presetDetails,
  type ProductShotFormat,
  productShotFormats,
  type ProductShotPreset,
  productShotPresets,
  type ShootList,
} from "#/features/productStudio/contracts";
import type { StudioSearch } from "#/features/productStudio/search";
import { fetchShoots, postShoot } from "#/features/productStudio/studio-client";
import { AccessCodeDialog } from "#/shared/components/access-code-dialog";
import { PageHeading } from "#/shared/components/page-heading";
import { SitePage } from "#/shared/components/site";
import { StateCard } from "#/shared/components/state-card";
import { ToolSection } from "#/shared/components/tool-layout";
import { uploadImageFile } from "#/shared/image-upload";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";
import { useAccessCode } from "#/shared/use-access-code";

type Form = {
  description: string;
  format: ProductShotFormat;
  presets: ProductShotPreset[];
  product: string;
};

const emptyForm: Form = { description: "", format: "square", presets: ["packshot"], product: "" };

/** What stands for each preset in the list of shots: one product, rendered as that preset. */
const presetImages: Record<ProductShotPreset, string> = { advertising, lifestyle, packshot };

/** The workspace's latest shoots, read again whenever `version` changes (a new shoot, a sign-in). */
function useRecentShoots(version: number) {
  const [shoots, setShoots] = useState<ShootList["shoots"]>([]);

  useEffect(() => {
    const controller = new AbortController();

    void fetchShoots(controller.signal).then((answer) => {
      if (controller.signal.aborted) {
        return;
      }

      if ("data" in answer) {
        setShoots(answer.data.shoots);
      }
    });

    return () => controller.abort();
  }, [version]);

  return shoots;
}

/** A field's label with its error on the same line, so the error moves nothing. */
function FieldHead({
  error,
  htmlFor,
  label,
}: {
  error: string | false;
  htmlFor: string;
  label: string;
}) {
  return (
    <div className="flex min-h-5 min-w-0 items-baseline justify-between gap-3">
      <Label htmlFor={htmlFor}>{label}</Label>
      {error && (
        <span
          className="min-w-0 truncate type-caption text-destructive-foreground"
          id={`${htmlFor}-error`}
          title={error}
        >
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * One kind of shot to tick: the box is the checkbox's own hit area, and being ticked changes only
 * its colors and the check.
 */
function ShotOption({
  checked,
  onChange,
  preset,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  preset: ProductShotPreset;
}) {
  const { label, summary } = presetDetails[preset];

  return (
    <label
      className={cn(
        "relative flex min-h-16 min-w-0 cursor-pointer items-center gap-3 rounded-field border py-2 pr-3.5 pl-2 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-ring",
        checked ? "border-brand/55 bg-brand/6" : "border-input bg-field hover:border-edge-strong",
      )}
    >
      <input
        checked={checked}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
        value={preset}
      />
      <span className="relative block size-12 shrink-0 overflow-hidden rounded-thumb">
        <img
          alt={`${label}, AI-generated image`}
          className="absolute inset-0 size-full object-cover"
          src={presetImages[preset]}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate type-label">{label}</span>
        <span className="truncate type-caption text-muted-foreground">{summary}</span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full",
          checked ? "bg-brand text-primary-foreground" : "border border-edge-strong",
        )}
      >
        {checked && <CheckIcon className="size-3" strokeWidth={3} />}
      </span>
    </label>
  );
}

/**
 * `/product-studio`: upload a product photo, say what it is, pick the shots (packshot, lifestyle,
 * advertising), optionally describe the scene and pick a format, and generate: one generation per
 * shot, admitted together as a shoot (`POST /api/product-shots`) under one request key, so a
 * double click or a resend after a lost answer returns the same shoot. The shoot shown is in the
 * URL (`?shoot=`), so a reload follows it. The product keeps its own pixels; only the scene around
 * it is generated. The recent shoots sit under both columns, where a shoot appearing moves nothing.
 */
export function ProductStudio({ search }: { search: StudioSearch }) {
  const navigate = useNavigate({ from: "/product-studio" });
  const access = useAccessCode();
  const [form, setForm] = useState<Form>(emptyForm);
  const [photo, setPhoto] = useState<ProductPhoto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProblem, setUploadProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Set<PropertyKey>>(new Set());
  const [version, setVersion] = useState(0);
  const recent = useRecentShoots(version);
  // The request key of the body last sent without an answer naming a shoot: sending the same
  // body again reuses it, so the server answers with the shoot the first request admitted.
  const unanswered = useRef<{ body: string; key: string } | null>(null);

  function needCode(resume: () => void, action: "generate" | "upload" | "unlock") {
    access.hold(action, action, () => {
      setVersion((count) => count + 1);
      resume();
    });
  }

  async function upload(file: File) {
    setUploading(true);
    setUploadProblem(null);

    const answer = await uploadImageFile(file);

    setUploading(false);

    if ("data" in answer) {
      setPhoto({ asset: answer.data, name: file.name });
    } else if (answer.refusal.reason === "access_required") {
      needCode(() => void upload(file), "upload");
    } else {
      setUploadProblem(answer.refusal.message);
    }
  }

  async function generate() {
    const parsed = createShootInputSchema.safeParse({
      description: form.description,
      format: form.format,
      presets: form.presets,
      product: form.product,
      product_asset_id: photo?.asset.id,
    });

    if (!parsed.success) {
      setFieldErrors(new Set(parsed.error.issues.map(({ path }) => path[0] ?? "form")));

      return;
    }

    setFieldErrors(new Set());
    setRefusal(null);
    setPending(true);

    const body = JSON.stringify(parsed.data);

    if (unanswered.current?.body !== body) {
      unanswered.current = { body, key: crypto.randomUUID() };
    }

    const answer = await postShoot(parsed.data, unanswered.current.key);

    setPending(false);

    if ("data" in answer) {
      unanswered.current = null;
      setVersion((count) => count + 1);
      void navigate({ resetScroll: false, search: { shoot: answer.data.id } });
    } else if (answer.refusal.reason === "access_required") {
      needCode(() => void generate(), "generate");
    } else {
      setRefusal(answer.refusal);
    }
  }

  const count = form.presets.length;
  const productError = fieldErrors.has("product") && "Say in a few words what the product is.";

  return (
    <SitePage category="Image" gap={10} onAccess={access.unlock} top={10}>
      <div className="flex flex-wrap items-start gap-10">
        <div className="flex max-w-105 min-w-0 flex-1 basis-90 flex-col gap-5">
          <PageHeading
            className="pb-1"
            subtitle="Your product, exactly as photographed. Only the scene is new."
            title="Product Studio"
          />

          <form
            className="flex min-w-0 flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void generate();
            }}
          >
            <PhotoField
              onFile={(file) => void upload(file)}
              photo={photo}
              problem={
                uploadProblem ??
                (!photo && fieldErrors.has("product_asset_id")
                  ? "Upload a product photo first."
                  : null)
              }
              uploading={uploading}
            />

            <div className="flex min-w-0 flex-col gap-2">
              <FieldHead error={productError} htmlFor="product-name" label="What is it?" />
              <Input
                aria-describedby={productError ? "product-name-error" : undefined}
                aria-invalid={productError ? true : undefined}
                id="product-name"
                maxLength={120}
                onChange={(event) => setForm({ ...form, product: event.target.value })}
                placeholder="A clear glass perfume bottle"
                value={form.product}
              />
            </div>

            <ToolSection
              end={
                fieldErrors.has("presets") && (
                  <span className="type-caption text-destructive-foreground">
                    Pick at least one shot.
                  </span>
                )
              }
              title="Shots"
            >
              <div aria-label="Shots" className="flex min-w-0 flex-col gap-2" role="group">
                {productShotPresets.map((preset) => (
                  <ShotOption
                    checked={form.presets.includes(preset)}
                    key={preset}
                    onChange={(checked) =>
                      setForm({
                        ...form,
                        presets: productShotPresets.filter((item) =>
                          item === preset ? checked : form.presets.includes(item),
                        ),
                      })
                    }
                    preset={preset}
                  />
                ))}
              </div>
            </ToolSection>

            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex min-h-5 min-w-0 items-baseline justify-between gap-3">
                <Label htmlFor="scene">Scene</Label>
                <span
                  className="min-w-0 truncate type-caption text-muted-foreground"
                  id="scene-note"
                  title="Glass and other see-through products keep the background they were photographed on."
                >
                  Glass products keep their original background
                </span>
              </div>
              <Textarea
                aria-describedby="scene-note"
                id="scene"
                maxLength={400}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="Optional: a white marble vanity, warm evening light"
                size="compact"
                value={form.description}
              />
            </div>

            <div className="flex min-w-0 flex-col gap-2">
              <Label asChild>
                <span>Format</span>
              </Label>
              <ToggleGroup
                aria-label="Format"
                onValueChange={(value) => {
                  const format = productShotFormats.find((item) => item === value);

                  if (format) {
                    setForm({ ...form, format });
                  }
                }}
                spacing={1}
                type="single"
                value={form.format}
                variant="segmented"
              >
                {productShotFormats.map((format) => (
                  <ToggleGroupItem key={format} value={format}>
                    {formatDetails[format].label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <Button disabled={pending || uploading} type="submit" variant="photon">
              <SparklesIcon aria-hidden="true" />
              <span>
                {pending
                  ? "Starting…"
                  : count === 0
                    ? "Generate shots"
                    : `Generate ${count} ${count === 1 ? "shot" : "shots"}`}
              </span>
            </Button>

            <div className="min-h-5">
              {refusal && (
                <p className="type-caption wrap-anywhere text-destructive-foreground" role="alert">
                  {refusal.message}
                </p>
              )}
            </div>
          </form>
        </div>

        <div className="min-w-0 grow-999 basis-120">
          {search.shoot ? (
            <ShootView
              key={search.shoot}
              onAccess={() => needCode(() => undefined, "unlock")}
              shootId={search.shoot}
            />
          ) : (
            <StateCard frame text="Fill in the form and generate." title="Your shots appear here" />
          )}
        </div>
      </div>

      {recent.length > 0 && (
        <ToolSection title="Earlier shoots">
          <ul className="grid tiles-fill-40 gap-3">
            {recent.map((shoot) => {
              const presets = shoot.presets.map((preset) => presetDetails[preset].label).join(", ");

              return (
                <li className="min-w-0" key={shoot.id}>
                  <Link
                    aria-current={shoot.id === search.shoot ? "page" : undefined}
                    className="group/shoot flex min-w-0 flex-col gap-2 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
                    search={{ shoot: shoot.id }}
                    to="/product-studio"
                  >
                    <span className="relative block aspect-square overflow-hidden rounded-lg bg-white shadow-hairline group-aria-[current=page]/shoot:shadow-picked">
                      <img
                        alt=""
                        className="absolute inset-0 size-full object-cover"
                        src={mediaUrl(shoot.product.image)}
                      />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span
                        className="truncate type-caption font-medium text-soft-foreground group-hover/shoot:text-foreground group-aria-[current=page]/shoot:font-semibold group-aria-[current=page]/shoot:text-foreground"
                        title={shoot.product.name}
                      >
                        {shoot.product.name}
                      </span>
                      <span className="truncate type-caption text-muted-foreground" title={presets}>
                        {presets}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </ToolSection>
      )}

      <AccessCodeDialog {...access.dialog} />
    </SitePage>
  );
}
