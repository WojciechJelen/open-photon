// The looks feature's public client module (`scripts/check-import-boundaries.mjs`): the direction
// editor that `src/app/composer-slots.ts` mounts in Motion Transfer's `directionEditor` slot, and
// the name of a look for its `lookName` slot. The catalog (`catalog.ts`) and the prompt composition
// (`compose.ts`) stay inside the feature: what a take keeps is the composed prompt in its recipe,
// never a look id.
export { LookEditor } from "#/features/looks/components/look-editor";

export { lookName } from "#/features/looks/compose";
