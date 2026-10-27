# Storyboard: ComfyUI evidence (Comfy Cloud, 2026-10-27)

Feature: pick a character, describe a short sequence, get four ordered, editable scene cards, and
render each card as its own image of that character. This records the two model steps on Comfy
Cloud (ComfyUI 0.43.0, cloud 0.509.0) through `feature-coord/comfy-run.ts`, which submits with this
repository's own SDK provider (`createSdkProvider`), holds the shared render lease, downloads every
output and records the balance delta. Every output image below was looked at.

**Verdict: pass, with the limitations listed at the end.** Each card follows its scene; identity
(face, hair, outfit) and rendering style hold across the four cards for all three characters once the
style is named; a card is an independent generation, so regenerating one cannot touch another (proved
byte for byte in the app's tests, `src/features/storyboard/server/storyboards.test.ts`). The text
model's split is a usable draft, not a finished script: the user reviews and edits it.

## 1. Splitting the sequence into four scenes (open-weights text model)

Three sequences (`sequences.json`):

| Case | Character | Sequence (abridged) | Why |
| --- | --- | --- | --- |
| maya | Maya (photo sample) | arrives on a rooftop at sunset, stretches, breakdances as the lights come on, sits on the ledge with water at night | time-of-day change, dance action |
| theo | Theo (stylized 3D sample) | reads a recipe, cracks eggs, takes the cake out of the oven, carries it lit into a dark room to a friend | props, a second person, interior light change |
| yuki | Yuki (anime sample) | **difficult**: rainy night, runs through a neon alley with a red umbrella AND a paper lantern, jumps a puddle, loses the umbrella to the wind, shelters under a shrine gate laughing | night, rain, two props, action, a prop lost mid-sequence |

Three graph versions, each run on all three sequences (sampling seed 1):

| Graph | Model | Result |
| --- | --- | --- |
| `graphs/split-flux3-upsampler.api.json` (runs `split-*`) | FLUX 3 prompt upsampler `qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors` (already pinned by characterBuilder), our system prompt | **rejected**. Ignored the rules on 3/3: invented the character's look (Maya "long dark hair in a high ponytail, rust-red jacket" vs. her braids and mustard hoodie; Yuki "black hair, dark blue jacket"), added `The caption reads "…"` sentences, Maya's four scenes on one line, 300–730 characters per scene. A fine-tune for prompt expansion, not instruction following. |
| `graphs/split-qwen35-4b-v2.api.json` (runs `split2-*`) | Qwen3.5 4B `qwen3.5_4b_bf16.safetensors` (Comfy-Org/Qwen3.5, Apache-2.0), template `llm_qwen3_5_text_gen.json` settings | **usable**: 3/3 four `Scene N:` lines, 140–200 characters, no appearance described, framing given. Story slips: Theo "cracking eggs with a fork, steam rising"; Yuki's "loses the umbrella" folded into "twisting", the umbrella back on the ground in scene 4; night only in Yuki's scene 1 (scenes 2–4 then render in daylight, see `yuki-v1`). |
| `src/features/storyboard/workflows/storyboard-scenes.v1.json` (the committed graph; runs `split3-*`, maya and yuki) | same | v2 plus one rule: "every scene is rendered on its own … repeat the time of day, weather and light and name every prop held". Yuki now says night/rain in 3 of 4 scenes. Slips remain: the lantern (not the umbrella) "floats away", then is held in scene 4; Maya "barefoot", "dark athletic wear" (an outfit mentioned although the prompt forbids it). |

Decision: Qwen3.5 4B (`storyboard-scenes.v1`). `parseScenes` accepts exactly four numbered scenes and
refuses anything else (shown as a failed split; the user writes or retries). All 9 answers above
parse. Because a 4B model still slips on plot details, every card is editable before rendering, and
the user can skip the model and write the four scenes by hand.

Split latency 5.4–60.0 s submit → done (Cloud queueing dominates; 1–3 s observed before running in
most), cost 0.25–1.04 ¢ per split.

## 2. Rendering the cards (reference-image edit)

Graph: `graphs/card-klein-landscape.api.json` = Foundation's `flux3-klein-edit.api.json` (FLUX 3
Image Klein distilled, the coordinator's choice for the shared `imageEdit`) with `EmptyFlux2LatentImage`
1344×768 wired to `7.latent_image` (landscape storyboard frames; the reference is a 768×1344
full-body sample from `src/features/characters/samples/characters/`). 16 steps, CFG 1, euler/simple,
**one seed for all four cards** (424242), so the cards share their noise. Prompt per card (the app's
`compileCardPrompt`):

> A storyboard frame. The character is the person in the reference image. *&lt;scene&gt;* Keep the
> character's face, hair, body and outfit exactly as in the reference image. Render it *&lt;style&gt;*,
> cinematic wide 16:9 composition, no text, no captions, no borders.

*&lt;style&gt;*: Maya "as a photograph in the same visual style as the reference image", Theo "as a
stylized 3D render …", Yuki first with the default "in the same visual style as the reference image"
(`yuki-card*`), then "as an anime-style illustration …" (`yuki-anime-card*`, scenes from `split3-yuki`).
Exact prompts: `cards.json`; each `runs/<case>/run.json` has the submitted values.

| Sheet (reference + cards 1–4) | What the images show |
| --- | --- |
| `sheets/maya-v1.jpg` | **pass.** Braids, face, mustard hoodie, black cargo pants and white sneakers identical on all four; photo style kept. 1 sunset rooftop, arms overhead (stretch; posed frontally like the reference); 2 twilight breakdance with motion blur and neon; 3 seated close-up with a water bottle under the moon; 4 seated on the ledge at night, bottle beside her. Scene 4's "silhouette" not followed. |
| `sheets/theo-v1.jpg` | **pass.** Curly ginger hair, freckles, teal tracksuit, orange sneakers, 3D style on all four. 1 sunny kitchen reading a recipe sheet; 2 cracking eggs into a bowl (with the split's odd fork and steam); 3 lifting the cake out of the oven; 4 dim living room at night, a lit candle on the cake, a friend waiting (a second person, correct). Scene 3's apron ignored (the prompt says keep the outfit). |
| `sheets/yuki-v1.jpg` (default style) | **mixed.** Identity holds (silver bob, red bomber, black skirt) but the look drifts from flat anime (card 1–2, semi-real backgrounds) to near-photoreal faces (3–4); night only in card 1, because only scene 1 said so; the lantern is not in her hand in 2–3. |
| `sheets/yuki-anime-v2.jpg` (named style, revised split) | **pass.** Anime style on all four; same face, hair, eyes, jacket, skirt. 1 neon alley at night, umbrella in one hand and lantern in the other, splashing; 2 mid-jump over the puddle, umbrella flipping, lantern flying away (as the scene said); 3 laughing under a stone gate in night rain; 4 laughing at the gate holding the lantern, rain, light closer to dusk. Pseudo-glyph shop signs in card 1 despite "no text"; scene 3's "from behind" not followed. |

Cards: 7.8–29.7 s submit → done (16 of 16 succeeded; 7.8–12.8 s when Cloud did not queue), 0.51–1.08 ¢
per card, so about 2–4 ¢ for a four-card storyboard plus ≤1 ¢ for its split.

Independence of cards: each card is a separate generation with its own prompt, seed and output; the
graph has one reference and one output, so a card's render reads nothing of the others. The app keeps
every card's generation history and a regenerate adds one generation for that card only; the server
test checks that cards 1, 3 and 4 keep their generation ids, asset ids and the SHA-256 of their stored
files after card 2 is regenerated, and that a failed card (provider failure) is retried alone.

## Models

| File | Where | Licence | Source |
| --- | --- | --- | --- |
| `qwen3.5_4b_bf16.safetensors` (split) | `text_encoders`, 9,319,828,320 B, SHA-256 `9fb3ae42003750fe2d16350259a3ec07761d6d13a8e2b244a6e22fa9d8050841` | Apache-2.0 (`cardData.license`) | `Comfy-Org/Qwen3.5` @ `5d50a2252bf1bcd49e5fee9b5f296986d442682b` (fits the `models.lock` schema; pinned in `src/features/storyboard/workflows/models.lock`) |
| `flux3-image-klein-int8-convrot.safetensors`, `qwen3vl_4b_int8_convrot.safetensors`, `flux2-vae.safetensors` (cards) | as `characterBuilder/workflows/models.lock` | FLUX-Kommunity-1.0 / Apache-2.0 | owned by the shared `imageEdit` workflow, not by this feature |
| `qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors` (rejected split) | as characterBuilder's lock | Apache-2.0 | benchmark only |

Node classes: `CLIPLoader`, `TextGenerate`, `SaveText` (split); `UNETLoader`, `CLIPLoader`,
`VAELoader`, `CLIPTextEncode`, `ConditioningZeroOut`, `LoadImage`, `ReferenceMultiLatent`,
`EmptyFlux2LatentImage`, `KSampler`, `VAEDecode`, `SaveImage` (cards): all core, none an API node, all
in Cloud's `object_info` and the pin's (`feature-coord/{cloud,pin}/object_info.json`). The committed
split graph passes the pin's `/prompt` validation except "`qwen3.5_4b_bf16.safetensors` not in []" (the
pin has no weights).

## Reproduce

```sh
C=/Users/wojciechjelen/workspace/comfy-challenge/open-photon-wt/feature-coord
W=/Users/wojciechjelen/workspace/comfy-challenge/open-photon-wt/feat-storyboard
# split (the committed graph)
node --experimental-strip-types $C/comfy-run.ts --repo $W --owner storyboard --label split3-yuki \
  --graph $W/src/features/storyboard/workflows/storyboard-scenes.v1.json --out $W/work/feature-evidence/storyboard/split3-yuki \
  --set '3.prompt=<sequence from sequences.json>' --set 3.sampling_mode.seed=1
# one card
node --experimental-strip-types $C/comfy-run.ts --repo $W --owner storyboard --label yuki-anime-card1 \
  --graph $W/docs/feature-evidence/storyboard/graphs/card-klein-landscape.api.json --out $W/work/feature-evidence/storyboard/yuki-anime-card1 \
  --image 11=$W/src/features/characters/samples/characters/yuki.png --set '4.text=<prompt from cards.json>' --set 7.seed=424242
```

Full-resolution PNGs stay in the ignored `work/feature-evidence/storyboard/`. Spend for this phase:
see the table in `runs.md`.

## Limitations

- **Style drift without a named style.** With "the same visual style as the reference image" alone, an
  anime reference drifted towards photoreal by card 3–4. Naming the style fixed it. The app therefore
  asks the user to pick the style (a "Like the character" option remains, with that warning).
- **Each card sees only its own text.** Time of day, weather and props carry over only when every
  scene says them; the split prompt asks for that, the user may need to add it.
- **The 4B split slips on plot details** (which prop is lost, an invented outfit detail) about once per
  sequence. Editable by design; never rendered without being shown first.
- **Poses tend towards the reference's** (frontal, upright) for calm actions; strong actions (dance,
  jump, carrying) were followed. Outfit changes asked by a scene (an apron) are ignored, since the
  prompt pins the outfit.
- "No text" is not always obeyed for signage in busy street scenes.
- Self-host: not verified (no pod in this program); the split model adds 9.3 GB to every pod's lock.
