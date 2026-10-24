// The presets' example takes (`samples/`), bundled by Vite: each file's URL by its name in the
// catalog (`example.video`, `example.poster`). Client code; the catalog test checks every named
// file exists.
const files = import.meta.glob<string>("./samples/*.{jpg,mp4}", {
  eager: true,
  import: "default",
  query: "?url",
});

/** The URL of `name`, a file of `samples/` the catalog names. */
export function previewUrl(name: string) {
  const url = files[`./samples/${name}`];

  if (url === undefined) {
    throw new Error(`No preset preview file ${name}`);
  }

  return url;
}
