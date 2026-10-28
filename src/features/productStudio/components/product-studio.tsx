import { Link, useNavigate } from "@tanstack/react-router";
import { ImageUpIcon, SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
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
import { AccessCodeDialog, AccessStatus } from "#/shared/components/access-code-dialog";
import { Hud, PageGlow } from "#/shared/components/brand";
import { SiteHeader } from "#/shared/components/site";
import type { Asset } from "#/shared/contracts";
import { IMAGE_UPLOAD_TYPES, uploadImageFile } from "#/shared/image-upload";
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

/**
 * The workspace's latest shoots, read again whenever `version` changes (a new shoot, a sign-in),
 * and whether that read had a session (`null` until it answers): the page's access status.
 */
function useRecentShoots(version: number) {
  const [shoots, setShoots] = useState<ShootList["shoots"]>([]);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void fetchShoots(controller.signal).then((answer) => {
      if (controller.signal.aborted) {
        return;
      }

      if ("data" in answer) {
        setShoots(answer.data.shoots);
        setSignedIn(true);
      } else if (answer.refusal.reason === "access_required") {
        setSignedIn(false);
      }
    });

    return () => controller.abort();
  }, [version]);

  return { shoots, signedIn, setSignedIn };
}

/**
 * `/product-studio`: upload a product photo, say what it is, pick the shots (packshot, lifestyle,
 * advertising), optionally describe the scene and pick a format, and generate: one generation per
 * shot, admitted together as a shoot (`POST /api/product-shots`) under one request key, so a
 * double click or a resend after a lost answer returns the same shoot. The shoot shown is in the
 * URL (`?shoot=`), so a reload follows it. The product keeps its own pixels; only the scene around
 * it is generated.
 */
export function ProductStudio({ search }: { search: StudioSearch }) {
  const navigate = useNavigate({ from: "/product-studio" });
  const access = useAccessCode();
  const [form, setForm] = useState<Form>(emptyForm);
  const [photo, setPhoto] = useState<Asset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Set<PropertyKey>>(new Set());
  const [version, setVersion] = useState(0);
  const { setSignedIn, shoots: recent, signedIn } = useRecentShoots(version);
  // The request key of the body last sent without an answer naming a shoot: sending the same
  // body again reuses it, so the server answers with the shoot the first request admitted.
  const unanswered = useRef<{ body: string; key: string } | null>(null);

  function needCode(resume: () => void, action: "generate" | "upload" | "unlock") {
    setSignedIn(false);
    access.hold(action, action, () => {
      setSignedIn(true);
      setVersion((count) => count + 1);
      resume();
    });
  }

  async function upload(file: File) {
    setUploading(true);
    setRefusal(null);

    const answer = await uploadImageFile(file);

    setUploading(false);

    if ("data" in answer) {
      setPhoto(answer.data);
    } else if (answer.refusal.reason === "access_required") {
      needCode(() => void upload(file), "upload");
    } else {
      setRefusal(answer.refusal);
    }
  }

  async function generate() {
    const parsed = createShootInputSchema.safeParse({
      description: form.description,
      format: form.format,
      presets: form.presets,
      product: form.product,
      product_asset_id: photo?.id,
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
      void navigate({ search: { shoot: answer.data.id } });
    } else if (answer.refusal.reason === "access_required") {
      needCode(() => void generate(), "generate");
    } else {
      setRefusal(answer.refusal);
    }
  }

  const count = form.presets.length;

  return (
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <SiteHeader category="Image">
        {signedIn !== null && <AccessStatus onOpen={access.unlock} signedIn={signedIn} />}
      </SiteHeader>
      <main className="mx-auto grid w-full max-w-330 gap-10 px-4 pt-6 pb-18 sm:px-8 lg:grid-cols-12 lg:pt-10">
        <section aria-labelledby="studio-heading" className="flex flex-col gap-6 lg:col-span-5">
          <div className="flex flex-col gap-3">
            <Hud>Image · Product Studio</Hud>
            <h1
              className="font-display text-4xl leading-none font-bold tracking-display"
              id="studio-heading"
            >
              Product Studio
            </h1>
            <p className="text-soft-foreground">
              Upload a product photo and get a packshot, a lifestyle scene or an ad visual. The
              product keeps its own pixels, so its shape, colours, logo and label text stay exactly
              as photographed; only the scene around it is generated.
            </p>
          </div>

          <form
            className="flex flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              void generate();
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="product-photo">Product photo</Label>
              <label
                className="flex cursor-pointer items-center gap-4 rounded-2xl border border-dashed p-4 focus-within:outline-2 focus-within:outline-ring hover:border-edge-strong"
                htmlFor="product-photo"
              >
                {photo ? (
                  <img
                    alt="The uploaded product photo"
                    className="size-20 rounded-xl border bg-white object-contain"
                    src={mediaUrl(photo)}
                  />
                ) : (
                  <span className="grid size-20 place-items-center rounded-xl border bg-foreground/4">
                    <ImageUpIcon aria-hidden="true" className="size-6" />
                  </span>
                )}
                <span className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">
                    {uploading ? "Uploading…" : photo ? "Replace the photo" : "Choose a photo"}
                  </span>
                  <span className="text-soft-foreground">
                    The whole product, front-on, on a plain background. PNG, JPEG or WebP.
                  </span>
                </span>
                <input
                  accept={IMAGE_UPLOAD_TYPES.join(",")}
                  aria-invalid={fieldErrors.has("product_asset_id") || undefined}
                  className="sr-only"
                  disabled={uploading}
                  id="product-photo"
                  onChange={(event) => {
                    const file = event.target.files?.[0];

                    event.target.value = "";

                    if (file) {
                      void upload(file);
                    }
                  }}
                  type="file"
                />
              </label>
              {fieldErrors.has("product_asset_id") && (
                <p className="text-sm text-destructive-foreground">Upload a product photo first.</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="product-name">What is it?</Label>
              <Input
                aria-invalid={fieldErrors.has("product") || undefined}
                id="product-name"
                maxLength={120}
                onChange={(event) => setForm({ ...form, product: event.target.value })}
                placeholder="e.g. a clear glass perfume bottle"
                value={form.product}
              />
              {fieldErrors.has("product") && (
                <p className="text-sm text-destructive-foreground">
                  Say in a few words what the product is.
                </p>
              )}
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Shots</legend>
              {productShotPresets.map((preset) => (
                <label
                  className="flex cursor-pointer items-start gap-3 rounded-2xl border p-4 hover:border-edge-strong has-data-[state=checked]:border-brand"
                  key={preset}
                >
                  <Checkbox
                    checked={form.presets.includes(preset)}
                    onCheckedChange={(checked) =>
                      setForm({
                        ...form,
                        presets: productShotPresets.filter((item) =>
                          item === preset ? checked === true : form.presets.includes(item),
                        ),
                      })
                    }
                    value={preset}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{presetDetails[preset].label}</span>
                    <span className="text-xs text-soft-foreground">
                      {presetDetails[preset].summary}
                    </span>
                  </span>
                </label>
              ))}
              {fieldErrors.has("presets") && (
                <p className="text-sm text-destructive-foreground">Pick at least one shot.</p>
              )}
            </fieldset>

            <div className="flex flex-col gap-2">
              <Label htmlFor="scene">Scene (optional)</Label>
              <Textarea
                aria-describedby="scene-hint"
                id="scene"
                maxLength={400}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="e.g. a white marble vanity in a hotel bathroom, warm evening light"
                value={form.description}
              />
              <p className="text-xs text-soft-foreground" id="scene-hint">
                Replaces each shot&apos;s own background.
              </p>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Format</legend>
              <ToggleGroup
                aria-label="Format"
                onValueChange={(value) => {
                  const format = productShotFormats.find((item) => item === value);

                  if (format) {
                    setForm({ ...form, format });
                  }
                }}
                spacing={2}
                type="single"
                value={form.format}
                variant="outline"
              >
                {productShotFormats.map((format) => (
                  <ToggleGroupItem key={format} value={format}>
                    {formatDetails[format].label} {formatDetails[format].ratio}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </fieldset>

            {refusal && (
              <p className="text-sm text-destructive-foreground" role="alert">
                {refusal.message}
              </p>
            )}

            <Button disabled={pending || uploading} size="lg" type="submit" variant="photon">
              <SparklesIcon aria-hidden="true" />
              {pending
                ? "Starting…"
                : count === 0
                  ? "Generate shots"
                  : `Generate ${count} ${count === 1 ? "shot" : "shots"}`}
            </Button>
            <p className="text-xs text-soft-foreground">
              Shots are AI-generated with open-weights models (FLUX 3 Image Klein, BiRefNet). Glass
              and other see-through products keep the background they were photographed on.
            </p>
          </form>
        </section>

        <div className="flex flex-col gap-10 lg:col-span-7">
          {search.shoot ? (
            <ShootView
              key={search.shoot}
              onAccess={() => needCode(() => undefined, "unlock")}
              shootId={search.shoot}
            />
          ) : (
            <section className="grid min-h-60 place-items-center rounded-3xl border border-dashed p-8 text-center text-soft-foreground">
              Your shots appear here.
            </section>
          )}

          {recent.length > 0 && (
            <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
              <h2 className="font-display text-xl font-semibold" id="recent-heading">
                Recent shoots
              </h2>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {recent.map((shoot) => (
                  <li key={shoot.id}>
                    <Link
                      aria-current={shoot.id === search.shoot ? "page" : undefined}
                      className="flex flex-col gap-2 rounded-2xl border p-2 text-sm hover:border-edge-strong aria-[current=page]:border-brand"
                      search={{ shoot: shoot.id }}
                      to="/product-studio"
                    >
                      <img
                        alt=""
                        className="aspect-square w-full rounded-xl bg-white object-contain"
                        src={mediaUrl(shoot.product.image)}
                      />
                      <span className="truncate font-medium">{shoot.product.name}</span>
                      <span className="text-xs text-soft-foreground">
                        {shoot.presets.map((preset) => presetDetails[preset].label).join(", ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
      <AccessCodeDialog {...access.dialog} />
    </div>
  );
}
