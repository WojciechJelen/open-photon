// What the builder remembers so neither a repeated click nor a reload pays twice, and a reload
// keeps unsent edits: the form as typed, and the request key of each request. Both live in
// memory for the page's life and are mirrored to the tab's `sessionStorage` when it takes them;
// the generations themselves are in the URL (`builder-search.ts`).
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
 * none), the seed's text, and the caption text with the basis it was edited from (`captionFor`,
 * a `captionBasis`). `caption: null` means untouched: the editor shows its basis's own caption.
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

/** Mirrors `value` to the tab's storage; whether it took it (disabled or full storage does not). */
function writeJson(key: string, value: BuilderForm | Requests) {
  try {
    const store = storage();

    store?.setItem(key, JSON.stringify(value));

    return store !== null;
  } catch {
    return false;
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

/**
 * One request key per action: the body it was made for, and `settled` once an answer named its
 * generation (an attempt's key is then spent; see `attemptKeyFor`).
 */
const requestsSchema = z.record(
  z.string(),
  z.object({ body: z.string(), key: z.uuid(), settled: z.boolean().default(false) }),
);

type Requests = z.output<typeof requestsSchema>;

// The ledger itself: in memory, so a key survives even where storage does not, read once from
// storage so it survives a reload where storage works.
let ledger: Requests | null = null;
let persisted = true;

function requests() {
  if (!ledger) {
    const parsed = requestsSchema.safeParse(readJson(requestsKey));

    ledger = parsed.success ? parsed.data : {};
  }

  return ledger;
}

function record(action: string, entry: Requests[string]) {
  ledger = { ...requests(), [action]: entry };
  persisted = writeJson(requestsKey, ledger);
}

/**
 * Whether the request keys reach the tab's storage, so a reload keeps them. Where they do not, a
 * repeated click is still the same request, but a reload forgets which ones were sent.
 */
export function keysPersist() {
  try {
    const store = storage();

    store?.setItem(`${requestsKey}:probe`, "1");
    store?.removeItem(`${requestsKey}:probe`);

    return persisted && store !== null;
  } catch {
    return false;
  }
}

/** A generation request as the builder sends it. */
type Body = CharacterCaptionInput | CharacterGenerationInput;

/**
 * The `request_key` of the `kind` request for `body`: the same body as that kind's last request
 * gets its key again (a double click, a resend after a lost answer, a reload), so the server
 * answers with the generation it made; another body gets a new key. `fresh` makes a new key
 * deliberately (the key was used by another access code).
 */
export function requestKeyFor(kind: "caption" | "image", body: Body, fresh = false) {
  const serialized = JSON.stringify(body);
  const last = requests()[kind];

  if (!fresh && last?.body === serialized) {
    return last.key;
  }

  const key = uuid();

  record(kind, { body: serialized, key, settled: false });

  return key;
}

/**
 * The `request_key` of a deliberate new attempt named `action` (a new image of a shown one, a
 * retry of a failed one) with `body`: one key for the action until an answer named its generation
 * (`settleAttempt`), however often it is sent, reloads included; a new key after that, or when
 * `fresh`.
 */
export function attemptKeyFor(action: string, body: Body, fresh = false) {
  const serialized = JSON.stringify(body);
  const last = requests()[action];

  if (!fresh && last && !last.settled && last.body === serialized) {
    return last.key;
  }

  const key = uuid();

  record(action, { body: serialized, key, settled: false });

  return key;
}

/**
 * The attempt `action` was answered: its key is spent, and its body is now the last `kind`
 * request, so sending the same body again answers with this generation, not an older one.
 */
export function settleAttempt(action: string, kind: "caption" | "image") {
  const entry = requests()[action];

  if (entry) {
    record(action, { ...entry, settled: true });
    record(kind, { ...entry, settled: false });
  }
}
