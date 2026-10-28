// The photoshoot settings: a small fixed catalog. Each setting is one place and four shots;
// every shot changes the pose, the framing and the light, so the four results of a session differ.
// The prompt of a shot is compiled here (client-safe, pure) and again by the server, which never
// takes a prompt from the client.

export const photoshootSettingIds = ["studio", "street", "editorial", "outdoors"] as const;

export type PhotoshootSettingId = (typeof photoshootSettingIds)[number];

type Shot = {
  /** Short label shown on a result card. */
  label: string;
  pose: string;
  framing: string;
  light: string;
};

type PhotoshootSetting = {
  id: PhotoshootSettingId;
  title: string;
  summary: string;
  scene: string;
  shots: readonly [Shot, Shot, Shot, Shot];
};

export const SHOTS_PER_SESSION = 4;

export const photoshootSettings: readonly PhotoshootSetting[] = [
  {
    id: "studio",
    title: "Studio",
    summary: "Seamless backdrop, softboxes, clean fashion portraits.",
    scene: "in a professional photo studio in front of a seamless paper backdrop",
    shots: [
      {
        label: "Three-quarter, hand on hip",
        pose: "standing turned three-quarters to the camera with one hand on the hip and the other arm relaxed",
        framing: "full-body shot from head to toe",
        light: "a large softbox key light from the left and a soft fill, on a light grey backdrop",
      },
      {
        label: "Arms crossed portrait",
        pose: "facing the camera with arms crossed and a confident expression",
        framing: "waist-up portrait",
        light:
          "moody Rembrandt lighting with a triangle of light on the shadow-side cheek, on a dark charcoal backdrop",
      },
      {
        label: "Seated on a stool",
        pose: "sitting on a simple wooden stool, leaning forward with forearms resting on the knees",
        framing: "full-body shot, camera at chest height",
        light: "bright high-key butterfly lighting on a pure white backdrop",
      },
      {
        label: "Mid-stride",
        pose: "walking toward the camera mid-stride with arms swinging naturally",
        framing: "full-body shot from a low angle",
        light:
          "dramatic coloured rim lights in teal and orange outlining the figure against a black backdrop",
      },
    ],
  },
  {
    id: "street",
    title: "Street",
    summary: "City sidewalks, crossings and storefronts.",
    scene: "on a busy city street",
    shots: [
      {
        label: "Leaning on a wall",
        pose: "leaning one shoulder against a brick wall with hands in the pockets",
        framing: "full-body shot",
        light: "warm golden-hour sunlight raking along the street from the side",
      },
      {
        label: "Crossing the street",
        pose: "walking across a zebra crossing, glancing sideways past the camera",
        framing: "full-body shot from across the street",
        light: "bright overcast daylight with soft shadows",
      },
      {
        label: "Café table",
        pose: "sitting at a small café table on the sidewalk, holding a coffee cup in one hand",
        framing: "waist-up shot",
        light: "dappled midday sun through a striped awning",
      },
      {
        label: "Neon night",
        pose: "standing under a shop sign at night looking straight into the camera",
        framing: "three-quarter-length shot",
        light: "pink and blue neon signs glowing on wet reflective pavement",
      },
    ],
  },
  {
    id: "editorial",
    title: "Editorial",
    summary: "Magazine-style interiors with striking light.",
    scene: "in a high-end fashion magazine editorial set in an elegant interior",
    shots: [
      {
        label: "Armchair",
        pose: "lounging sideways in a velvet armchair with one arm draped over the backrest",
        framing: "full-body shot",
        light: "soft window light from tall windows with long shadows",
      },
      {
        label: "Close-up, hand to chin",
        pose: "resting the chin lightly on one hand and looking off to the side",
        framing: "tight head-and-shoulders close-up",
        light: "hard direct flash with a crisp shadow on the wall behind",
      },
      {
        label: "Staircase",
        pose: "standing on a sweeping marble staircase with one hand on the banister, looking back over the shoulder",
        framing: "full-body shot from below",
        light: "warm chandelier light and deep shadows",
      },
      {
        label: "Gallery wall",
        pose: "standing upright against a bold colour-block wall, arms relaxed at the sides, chin raised",
        framing: "full-body shot, symmetric composition",
        light: "even, graphic light with saturated colours",
      },
    ],
  },
  {
    id: "outdoors",
    title: "Outdoors",
    summary: "Nature: meadows, beaches, forests and mountains.",
    scene: "outdoors in nature",
    shots: [
      {
        label: "Meadow",
        pose: "walking through a flower meadow, one hand brushing the tall grass",
        framing: "full-body shot",
        light: "warm backlight from a low sun with a soft glow around the hair",
      },
      {
        label: "Beach",
        pose: "standing barefoot at the edge of the surf, looking toward the horizon in profile",
        framing: "full-body shot",
        light: "soft pastel light at dusk",
      },
      {
        label: "Forest path",
        pose: "sitting on a fallen log on a forest path with hands clasped",
        framing: "three-quarter-length shot",
        light: "cool shade with shafts of sunlight through the trees",
      },
      {
        label: "Mountain lookout",
        pose: "standing on a rocky mountain lookout with arms raised in triumph",
        framing: "full-body shot from a low angle with the valley behind",
        light: "crisp bright midday sun under a deep blue sky",
      },
    ],
  },
];

export function photoshootSetting(id: PhotoshootSettingId): PhotoshootSetting {
  const setting = photoshootSettings.find((entry) => entry.id === id);

  if (!setting) throw new Error(`Unknown photoshoot setting: ${id}`);

  return setting;
}

/**
 * A shot's request to the edit workflow, which runs FLUX 3 Klein's prompt upsampler first (it
 * sees the reference and writes the full caption the edit renders). The new picture comes first
 * (framing, place, pose, light) so the reference's own pose does not carry over, then the medium,
 * then what must survive. It never says "photograph": the upsampler read that as "turn a drawn
 * character into a real person" (`docs/feature-evidence/character-photoshoot/`, prompt p2).
 */
export function compileShotPrompt(settingId: PhotoshootSettingId, shot: number): string {
  const setting = photoshootSetting(settingId);
  const entry = setting.shots[shot];

  if (!entry) throw new Error(`Shot ${shot} is out of range`);

  const framing = entry.framing.charAt(0).toUpperCase() + entry.framing.slice(1);

  return `${framing}: the person from the reference image ${setting.scene}. The person is ${entry.pose}; the pose, camera angle and background are completely new, nothing of the reference's pose or backdrop remains. Lighting: ${entry.light}. Keep the exact visual style and medium of the reference image: a drawing or anime illustration stays a drawing in the same style, a 3D render stays a 3D render, a photo stays a photo. Keep exactly the same face, hairstyle, skin tone, body build, outfit, shoes and accessories. One person only, natural anatomy with complete hands.`;
}
