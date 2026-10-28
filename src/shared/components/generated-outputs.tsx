import { GeneratedImage } from "#/shared/components/generated-image";
import { GeneratedVideo } from "#/shared/components/generated-video";
import type { NavigationCategory } from "#/shared/components/site-navigation";
import type { GenerationOutput } from "#/shared/contracts";

/** A further file's output name (`outputFileName`): its output's name, `-` and its place. */
const FURTHER_FILE = /^(.+)-(\d+)$/;

/** `name` as its output's (`base`) and the `-<place>` of a further file (`suffix`, else empty). */
function splitName(name: string) {
  const further = FURTHER_FILE.exec(name);

  return further?.[1] && further[2]
    ? { base: further[1], suffix: `-${further[2]}` }
    : { base: name, suffix: "" };
}

/**
 * What a result or share page shows of a generation's file outputs, in their order: its images,
 * its videos each with its poster, and what it is shown as (`media`, a video before an image;
 * `null` with neither) and under which category of the main navigation. A poster is a video's
 * still, never shown on its own. Only one video output cuts posters (`outputsProblem`), `poster`
 * for its first file and `poster-<N>` for its `<name>-<N>`: the output named `video`, else the
 * only video output there is; any other video has none.
 */
export function shownOutputs<Output extends GenerationOutput>(outputs: readonly Output[]) {
  const images = outputs.filter(({ media }) => media === "image");
  const files = outputs.filter(({ media }) => media === "video");
  const bases = new Set(files.map(({ name }) => splitName(name).base));
  const posterOwner = bases.has("video") ? "video" : bases.size === 1 ? [...bases][0] : undefined;

  const videos = files.map((video) => {
    const { base, suffix } = splitName(video.name);

    const poster =
      base === posterOwner
        ? outputs.find(({ media, name }) => media === "poster" && name === `poster${suffix}`)
        : undefined;

    return { poster: poster ?? null, video };
  });

  const media: "image" | "video" | null =
    videos.length > 0 ? "video" : images.length > 0 ? "image" : null;

  const category: NavigationCategory | undefined =
    media === "video" ? "Video" : media === "image" ? "Image" : undefined;

  return { category, images, media, videos };
}

/** What a page that shows a generation as `media` is called: it says it is AI-generated. */
export function generatedTitle(media: "image" | "video") {
  return `AI-generated ${media} · Open Photon`;
}

/**
 * Which of a generation's `count` outputs of `media` the one at `index` is (`image 2 of 3`,
 * `video 2 of 3`); `undefined` when it is the only one.
 */
function outputPlace(media: "image" | "video", index: number, count: number) {
  return count > 1 ? `${media} ${index + 1} of ${count}` : undefined;
}

/**
 * A generation's file outputs as its result and share pages show them, in their order, each
 * disclosed as AI-generated with Download: every image (`GeneratedImage`) and every video with its
 * poster (`GeneratedVideo`); a poster is not shown on its own. Several of one media are told apart
 * by their place (`image 2 of 3`).
 */
export function GeneratedOutputs({ outputs }: { outputs: readonly GenerationOutput[] }) {
  const { images, videos } = shownOutputs(outputs);

  return outputs.map((output) => {
    if (output.media === "image") {
      return (
        <GeneratedImage
          asset={output.asset}
          download
          key={output.name}
          place={outputPlace("image", images.indexOf(output), images.length)}
        />
      );
    }

    const index = videos.findIndex(({ video }) => video === output);
    const shown = videos[index];

    return shown ? (
      <GeneratedVideo
        asset={output.asset}
        download
        key={output.name}
        place={outputPlace("video", index, videos.length)}
        poster={shown.poster?.asset ?? null}
      />
    ) : null;
  });
}
