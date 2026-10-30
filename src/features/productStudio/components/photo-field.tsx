import { cn } from "cn";
import { ImageUpIcon, LoaderCircleIcon, UploadIcon } from "lucide-react";

import { Label } from "#/components/ui/label";
import type { Asset } from "#/shared/contracts";
import { IMAGE_UPLOAD_TYPES } from "#/shared/image-upload";
import { mediaUrl } from "#/shared/media";

/** The product photo as the form holds it: the stored asset and the file it came from. */
export type ProductPhoto = { asset: Asset; name: string };

/**
 * The product photo's upload box, the same size in every state: its thumbnail, the file's name and,
 * on the line under it, what to upload or `problem` in its place. The whole box is the file input's
 * label, so a click anywhere browses; the input stays in the page and takes the keyboard focus.
 */
export function PhotoField({
  onFile,
  photo,
  problem,
  uploading,
}: {
  onFile: (file: File) => void;
  photo: ProductPhoto | null;
  problem: string | null;
  uploading: boolean;
}) {
  const name = uploading ? "Uploading…" : (photo?.name ?? "Choose a photo");

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor="product-photo">Product photo</Label>
      <label
        className={cn(
          "flex min-w-0 items-center gap-3 rounded-field border border-input bg-field py-2 pr-3.5 pl-2 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-ring",
          uploading ? "cursor-progress" : "cursor-pointer hover:border-edge-strong",
          problem && "border-destructive",
        )}
        htmlFor="product-photo"
      >
        <span
          className={cn(
            "relative grid h-16 w-13 shrink-0 place-items-center overflow-hidden rounded-thumb text-muted-foreground",
            photo ? "bg-white" : "bg-foreground/4",
          )}
        >
          {photo ? (
            <img
              alt="The uploaded product photo"
              className="absolute inset-0 size-full object-cover"
              src={mediaUrl(photo.asset)}
            />
          ) : (
            <ImageUpIcon aria-hidden="true" className="size-5" strokeWidth={1.75} />
          )}
          {uploading && (
            <span
              aria-hidden="true"
              className="absolute inset-0 grid place-items-center bg-background/66 text-foreground"
            >
              <LoaderCircleIcon className="size-5 motion-safe:animate-spin" strokeWidth={1.75} />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate type-label" title={name}>
            {name}
          </span>
          {problem ? (
            <span
              className="line-clamp-2 type-caption wrap-anywhere text-destructive-foreground"
              role="alert"
              title={problem}
            >
              {problem}
            </span>
          ) : (
            <span className="truncate type-caption text-muted-foreground">
              Whole product, front-on
            </span>
          )}
        </span>
        <UploadIcon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
        <input
          accept={IMAGE_UPLOAD_TYPES.join(",")}
          aria-invalid={problem !== null || undefined}
          className="sr-only"
          disabled={uploading}
          id="product-photo"
          onChange={(event) => {
            const file = event.target.files?.[0];

            event.target.value = "";

            if (file) {
              onFile(file);
            }
          }}
          type="file"
        />
      </label>
    </div>
  );
}
