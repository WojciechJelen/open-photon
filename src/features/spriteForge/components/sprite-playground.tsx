import { RotateCwIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useReducer, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import {
  type AtlasDescription,
  rowTag,
  type SheetRow,
  sheetRows,
} from "#/features/spriteForge/contracts";

const WIDTH = 960;
const HEIGHT = 600;

// The strip of eight walking directions takes at most this many canvas pixels of height.
const STRIP_MAX_HEIGHT = 160;
const STRIP_TOP = 12;
const GAP = 8;

// Canvas pixels per millisecond at zoom 1; a diagonal step is as long as a straight one.
const SPEED = 0.06;
const TILE = 48;

/** The row a held step points to: `dx` and `dy` are -1, 0 or 1 (screen axes, y down). */
const stepRows = {
  "-1,-1": "nw",
  "-1,0": "w",
  "-1,1": "sw",
  "0,-1": "n",
  "0,1": "s",
  "1,-1": "ne",
  "1,0": "e",
  "1,1": "se",
} as const satisfies Record<string, SheetRow>;

const keyAxes = {
  a: [-1, 0],
  arrowdown: [0, 1],
  arrowleft: [-1, 0],
  arrowright: [1, 0],
  arrowup: [0, -1],
  d: [1, 0],
  s: [0, 1],
  w: [0, -1],
} as const satisfies Record<string, readonly [number, number]>;

type AxisKey = keyof typeof keyAxes;

/** Whether `key` is one of `table`'s own keys (a key the page's tables know). */
function hasKey<T extends object>(table: T, key: PropertyKey): key is keyof T {
  return Object.hasOwn(table, key);
}

type Point = { x: number; y: number };

/** The walking character: where its feet are, the row it faces and how long it has walked. */
type Hero = { at: Point; row: SheetRow; time: number };

type Rect = AtlasDescription["frames"][number]["frame"];

/** An atlas as drawing reads it: its frames' rects and durations, each row's span, the pivots. */
type Atlas = {
  cell: { h: number; w: number };
  frames: { duration: number; rect: Rect }[];
  pivotAt: (frame: number) => Point;
  spanOf: (row: SheetRow) => { from: number; to: number };
};

function readAtlas(description: AtlasDescription): Atlas {
  const frames = description.frames.map(({ duration, frame }) => ({ duration, rect: frame }));
  const tags = new Map(description.meta.frameTags.map((tag) => [tag.name, tag]));
  const fallbackTag = description.meta.frameTags[0] ?? { from: 0, to: 0 };
  const pivots = description.meta.slices.find((slice) => slice.name === "pivot")?.keys ?? [];
  const first = frames[0]?.rect ?? { h: 1, w: 1, x: 0, y: 0 };
  // Without a pivot slice, a cell's feet are taken to be at its bottom centre.
  const fallbackPivot = { x: first.w / 2, y: first.h };

  return {
    cell: { h: first.h, w: first.w },
    frames,
    // An Aseprite slice key holds from its frame until the next key.
    pivotAt: (frame) => {
      let pivot = fallbackPivot;

      for (const key of pivots) {
        if (key.frame <= frame) {
          pivot = key.pivot;
        }
      }

      return pivot;
    },
    spanOf: (row) => tags.get(rowTag(row)) ?? fallbackTag,
  };
}

/** The frame of `row` at `time` ms into its loop; its first frame when it is not `moving`. */
function frameAt(atlas: Atlas, row: SheetRow, time: number, moving: boolean) {
  const { from, to } = atlas.spanOf(row);
  const frames = atlas.frames.slice(from, to + 1);
  const total = frames.reduce((sum, frame) => sum + frame.duration, 0);

  if (!moving || total === 0) {
    return from;
  }

  let left = time % total;

  for (const [offset, frame] of frames.entries()) {
    if (left < frame.duration) {
      return from + offset;
    }

    left -= frame.duration;
  }

  return from;
}

function drawGround(context: CanvasRenderingContext2D) {
  context.fillStyle = "#3b4a3a";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = "#435443";

  for (let y = 0; y < HEIGHT; y += TILE) {
    for (let x = (y / TILE) % 2 ? 0 : TILE; x < WIDTH; x += TILE * 2) {
      context.fillRect(x, y, TILE, TILE);
    }
  }
}

/** Draws frame `index` with its pivot at `at`, `scale` canvas pixels per atlas pixel. */
function drawFrame(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  atlas: Atlas,
  index: number,
  at: Point,
  scale: number,
) {
  const rect = atlas.frames[index]?.rect;

  if (!rect) {
    return;
  }

  const pivot = atlas.pivotAt(index);

  context.drawImage(
    image,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    Math.round(at.x - pivot.x * scale),
    Math.round(at.y - pivot.y * scale),
    rect.w * scale,
    rect.h * scale,
  );
}

/**
 * A sheet played as a game would: the eight walk directions side by side along the top, and a
 * hero below them that walks with WASD or the arrow keys (1–4 zoom it), using only the atlas
 * image and its Aseprite JSON (tags `walk_<row>`, the `pivot` slice anchoring the feet). Keys
 * count only while the canvas has focus, so the page's own shortcuts and fields keep theirs, and
 * held keys are let go when the canvas, the window or the tab loses focus.
 * With reduced motion asked for, the strip stands still; the hero moves only when walked.
 * An atlas image that fails to load stops the loop and says so, with a button to load it again.
 */
export function SpritePlayground({
  atlas: description,
  imageUrl,
}: {
  atlas: AtlasDescription;
  imageUrl: string;
}) {
  const hintId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const held = useRef(new Set<AxisKey>());
  const zoomRef = useRef(2);
  // The image URL whose load failed; a new `imageUrl` starts out unfailed.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [attempts, reattempt] = useReducer((count: number) => count + 1, 0);
  const failed = failedUrl === imageUrl;

  useEffect(() => {
    const keys = held.current;
    const release = () => keys.clear();

    const hide = () => {
      if (document.visibilityState === "hidden") {
        keys.clear();
      }
    };

    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", hide);

    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");

    if (!context) {
      return;
    }

    const atlas = readAtlas(description);
    const { cell } = atlas;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const image = new Image();
    let loaded = false;
    let frameRequest = 0;
    let last = performance.now();

    // The strip takes the largest whole scale at which all eight cells fit the width and its
    // height; the hero walks in the band below it, at a zoom that keeps it on the canvas.
    const slot = WIDTH / sheetRows.length;

    const stripScale = Math.max(
      1,
      Math.floor(Math.min((slot - GAP) / cell.w, STRIP_MAX_HEIGHT / cell.h)),
    );

    const stripBottom = STRIP_TOP + cell.h * stripScale;
    const maxZoom = Math.max(1, Math.floor((HEIGHT - 4 - stripBottom - GAP) / cell.h));
    const hero: Hero = { at: { x: WIDTH / 2, y: HEIGHT - 4 }, row: "s", time: 0 };

    zoomRef.current = cell.h <= 80 ? 4 : 2;

    const onLoad = () => {
      loaded = true;
    };

    // A failed image leaves nothing to animate: paint the ground once and stop the loop.
    const onError = () => {
      cancelAnimationFrame(frameRequest);
      drawGround(context);
      setFailedUrl(imageUrl);
    };

    image.addEventListener("load", onLoad);
    image.addEventListener("error", onError);
    image.src = imageUrl;

    // An arrow, not a hoisted declaration, so `context` stays narrowed to non-null inside it.
    const tick = (now: number) => {
      const elapsed = Math.min(50, now - last);

      last = now;
      drawGround(context);

      if (loaded) {
        const zoom = Math.min(maxZoom, zoomRef.current);
        let dx = 0;
        let dy = 0;

        for (const key of held.current) {
          dx += keyAxes[key][0];
          dy += keyAxes[key][1];
        }

        dx = Math.sign(dx);
        dy = Math.sign(dy);

        const walking = dx !== 0 || dy !== 0;
        const half = (cell.w * zoom) / 2;
        const top = stripBottom + GAP + cell.h * zoom;
        const step = walking ? SPEED * zoom * (dx && dy ? Math.SQRT1_2 : 1) * elapsed : 0;

        const facing = `${dx},${dy}`;

        if (hasKey(stepRows, facing)) {
          hero.row = stepRows[facing];
        }

        hero.at = {
          x: Math.max(half, Math.min(WIDTH - half, hero.at.x + dx * step)),
          y: Math.max(top, Math.min(HEIGHT - 4, hero.at.y + dy * step)),
        };
        hero.time += walking ? elapsed : 0;

        context.imageSmoothingEnabled = false;
        sheetRows.forEach((row, index) => {
          drawFrame(
            context,
            image,
            atlas,
            frameAt(atlas, row, now, !motion.matches),
            { x: slot * (index + 0.5), y: stripBottom },
            stripScale,
          );
        });
        drawFrame(
          context,
          image,
          atlas,
          frameAt(atlas, hero.row, hero.time, walking),
          hero.at,
          zoom,
        );
      }

      frameRequest = requestAnimationFrame(tick);
    };

    frameRequest = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameRequest);
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
    };
  }, [attempts, description, imageUrl]);

  function press(event: KeyboardEvent<HTMLCanvasElement>) {
    const key = event.key.toLowerCase();

    if (hasKey(keyAxes, key)) {
      // Arrows would scroll the page and WASD would reach the page's shortcuts.
      event.preventDefault();
      held.current.add(key);
    } else if (/^[1-4]$/.test(key)) {
      event.preventDefault();
      zoomRef.current = Number(key);
    }
  }

  function lift(event: KeyboardEvent<HTMLCanvasElement>) {
    const key = event.key.toLowerCase();

    if (hasKey(keyAxes, key)) {
      held.current.delete(key);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        aria-describedby={hintId}
        aria-label="Sprite playground"
        className="w-full rounded-xl border pixelated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        height={HEIGHT}
        onBlur={() => held.current.clear()}
        onClick={(event) => event.currentTarget.focus()}
        onKeyDown={press}
        onKeyUp={lift}
        ref={canvasRef}
        role="application"
        tabIndex={0}
        width={WIDTH}
      />
      {failed ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive-foreground" id={hintId} role="alert">
            The atlas image could not be loaded.
          </p>
          <Button
            onClick={() => {
              setFailedUrl(null);
              reattempt();
            }}
            size="sm"
            variant="outline"
          >
            <RotateCwIcon />
            Reload the atlas image
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground" id={hintId}>
          Click the playground, then walk with WASD or the arrow keys; 1–4 change the zoom.
        </p>
      )}
    </div>
  );
}
