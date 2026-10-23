// What the builder keeps in the tab's `sessionStorage` so a reload neither loses unsent edits nor
// pays twice: the form as typed, and the request key of the last request of each kind. The
// generations themselves are in the URL (`builder-search.ts`); this only holds what is not sent
// yet, or what makes a repeated send the same request.
import { z } from "zod";

import {
  type CharacterCaptionInput,
  type CharacterGenerationInput,
  characterStyles,
} from "#/features/characterBuilder/contracts";

const formKey = "characterBuilder:form";
const requestsKey = "characterBuilder:requests";

/**
 * The form as typed: the description and controls (`appearance`, `outfit`, `style`; blank is
 * none), and the caption text with the generation it was edited from (`captionFor`: a caption
 * generation's id, or `null` for a caption written without one). `caption: null` means
 * untouched: the enhanced caption (or, written by hand, the compiled request) is shown.
 */
const builderFormSchema = z.object({
  appearance: z.string(),
  caption: z.string().nullable(),
  captionFor: z.string().nullable(),
  description: z.string(),
  outfit: z.string(),
  seed: z.string(),
  style: z.enum(characterStyles).nullable(),
});

export type BuilderForm = z.output<typeof builderFormSchema>;

export const emptyForm: BuilderForm = {
  appearance: "",
  caption: null,
  captionFor: null,
  description: "",
  outfit: "",
  seed: "",
  style: null,
};

function storage() {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Storage disabled (a privacy mode): the builder works, it just forgets on reload.
    return null;
  }
}

function readJson(key: string) {
  try {
    const stored: unknown = JSON.parse(storage()?.getItem(key) ?? "null");

    return stored;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: BuilderForm | Requests) {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or disabled: nothing to keep then.
  }
}

/** The form this tab typed last, or `null`. */
export function recallForm() {
  const parsed = builderFormSchema.safeParse(readJson(formKey));

  return parsed.success ? parsed.data : null;
}

export function rememberForm(form: BuilderForm) {
  writeJson(formKey, form);
}

/** A random UUID v4, also where `crypto.randomUUID` is missing (a page served over plain http). */
function uuid() {
  const hex = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  // Version 4, and the RFC 4122 variant (the 17th digit is 8, 9, a or b).
  const variant = "89ab"[Number.parseInt(hex.charAt(16), 16) % 4];

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20)}`;
}

const requestsSchema = z.record(z.string(), z.object({ body: z.string(), key: z.uuid() }));

type Requests = z.output<typeof requestsSchema>;

/**
 * The `request_key` for sending `body` as a `kind` request. The same body as the last one of its
 * kind gets that request's key again (a double click, a resend after a lost answer, a reload),
 * so the server answers with the generation the first one made; another body, or a deliberate new
 * attempt (`fresh`: "Enhance again", "Generate another"), gets a new key, and so a new generation.
 */
export function requestKeyFor(
  kind: "caption" | "image",
  body: CharacterCaptionInput | CharacterGenerationInput,
  fresh: boolean,
) {
  const parsed = requestsSchema.safeParse(readJson(requestsKey));
  const requests = parsed.success ? parsed.data : {};
  const serialized = JSON.stringify(body);
  const last = requests[kind];

  if (!fresh && last?.body === serialized) {
    return last.key;
  }

  const key = uuid();

  writeJson(requestsKey, { ...requests, [kind]: { body: serialized, key } });

  return key;
}
