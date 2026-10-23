# Workflows

`character-generation.v1.json` is the executable API-format graph the app submits for a character image: FLUX.2 [klein] 4B, distilled (4 steps, CFG 1), text to one PNG. `definition.ts` runs it through the generation service; `POST /api/character-generations` (`server/generate.ts`) is its entry.

## Origin

It is the **distilled** subgraph of Comfy's official template `templates/image_flux2_klein_text_to_image.json` from [Comfy-Org/workflow_templates@cd54dbb](https://github.com/Comfy-Org/workflow_templates/blob/cd54dbbd4a219664ebd049dcb372a785b35cd25e/templates/image_flux2_klein_text_to_image.json) (2026-10-16, the last commit touching the file; `main` was `6798463` on 2026-10-22 and served the same bytes, SHA-256 `cd4a29b0be6f71a7391f2f023e69dfc3b47d7da9f2aa215b4c8b8e17c2eea107`). The template is UI format (frontend 1.38.6). The upstream repository is MIT licensed; see [`LICENSE.upstream`](LICENSE.upstream).

The template holds two subgraph instances fed by one prompt node:

| Top-level node | What it is | In v1 |
| --- | --- | --- |
| `76` `PrimitiveStringMultiline` "Prompt" | the shared prompt | inlined as `77:74.text` |
| `75` → `9` `SaveImage` | subgraph `7b34ab90-…` "Text to Image (FLUX.2 Klein 4B)": base model, 20 steps, CFG 5 | dropped |
| `77` → `78` `SaveImage` | subgraph `a67caa28-5f85-4917-8396-36004960dd30` "Text to Image (FLUX.2 Klein 4B Distilled)" | kept |
| `79` `MarkdownNote` | model links | dropped |

## Flattening

ComfyUI has no API export of a UI file without a running frontend, so a one-shot script (not kept) did what the frontend's export does: every node of the distilled subgraph becomes `77:<inner id>`, its widget values become literal inputs in `object_info`'s input order, its links become `["77:<id>", slot]`, and `SaveImage` keeps its top-level id `78`, wired to the subgraph's output (`77:65`, `VAEDecode`). Beyond that, three changes:

1. The two `PrimitiveInt` nodes `68` "Width" and `69` "Height" (1024 each) are removed; their value is inlined into the four fields they fed, `77:66.width/height` (`EmptyFlux2LatentImage`) and `77:62.width/height` (`Flux2Scheduler`), so every app parameter binds a literal field.
2. The top-level `PrimitiveStringMultiline` `76` is removed; its text is inlined into `77:74.text`. The app always replaces it.
3. `RandomNoise` `77:73`'s `control_after_generate: "randomize"` is dropped: it is a frontend widget, not a node input. The template's seed `432262096973490` stays as the literal the app replaces.

`_meta.title` is the node's UI title, else `object_info`'s display name, else its class. The file is formatted by `oxfmt` (two spaces), so its SHA-256 is of those bytes.

| Node | Class | Inputs |
| --- | --- | --- |
| `77:70` | `UNETLoader` | `flux-2-klein-4b.safetensors`, `weight_dtype: default` |
| `77:71` | `CLIPLoader` | `qwen_3_4b.safetensors`, `type: flux2`, `device: default` |
| `77:72` | `VAELoader` | `flux2-vae.safetensors` |
| `77:74` | `CLIPTextEncode` | `text` (prompt), `clip` ← `77:71` |
| `77:76` | `ConditioningZeroOut` | ← `77:74` (the distilled model's negative) |
| `77:63` | `CFGGuider` | `cfg: 1`, model ← `77:70`, positive ← `77:74`, negative ← `77:76` |
| `77:66` | `EmptyFlux2LatentImage` | `width`, `height`, `batch_size: 1` |
| `77:62` | `Flux2Scheduler` | `steps: 4`, `width`, `height` |
| `77:61` | `KSamplerSelect` | `euler` |
| `77:73` | `RandomNoise` | `noise_seed` |
| `77:64` | `SamplerCustomAdvanced` | noise, guider, sampler, sigmas, latent |
| `77:65` | `VAEDecode` | ← `77:64`, `77:72` |
| `78` | `SaveImage` | `filename_prefix: Flux2-Klein`, images ← `77:65` |

Every class is ComfyUI core. Comfy Cloud's `object_info` (fetched 2026-10-23) lists all thirteen with `python_module` `nodes`, `comfy_extras.nodes_flux` or `comfy_extras.nodes_custom_sampler` and no `api_node`, and its loaders offer all three files; `node scripts/check-models-lock.mjs --definitions <that object_info> character-generation.v1.json` passes. At the self-host pin `7a28332`, `comfy_extras/nodes_flux.py` defines `EmptyFlux2LatentImage` and `Flux2Scheduler` and `nodes.py` lists `flux2` among `CLIPLoader`'s types (read from the source at that commit; no pod ran it). No custom node pack is needed. `npm run check:open-weights` passes.

## Inputs map

[`character-generation.v1.inputs.json`](character-generation.v1.inputs.json):

| Param | Node.field | |
| --- | --- | --- |
| `prompt` | `77:74.text` (`CLIPTextEncode`) | |
| `seed` | `77:73.noise_seed` (`RandomNoise`) | |
| `width`, `height` | `77:66.width/height` (`EmptyFlux2LatentImage`) **and** `77:62.width/height` (`Flux2Scheduler`) | `Flux2Scheduler` derives its sigma shift from the image size, so both must get the same value. The entry is a list of bindings (`inputsMapSchema`, `src/shared/server/workflow-graph.ts`); each gets the value and each is checked for its class and a literal field. |

## Recipe and defaults

`definition.ts` resolves a request (`contracts.ts`: `prompt` 1–1000 characters after trimming, optional `seed`, optional `width`/`height`, multiples of 16 from 512 to 2048) into a strict recipe: `params { prompt, seed, width, height }`, `target`, `workflow { id: "character-generation", version: 1, sha256 }`, and `models` from [`models.lock`](models.lock). A request without a seed gets a random one (below 2^48), drawn once and stored, so a retry or re-run renders from the recipe, never from a new draw. [`defaults.json`](defaults.json) holds the size a request without one renders at: **768×1344**, chosen by the spike below.

## Models

[`models.lock`](models.lock) pins all three files from [`Comfy-Org/Flux-2-Klein-4B`](https://huggingface.co/Comfy-Org/Flux-2-Klein-4B) at commit `533c4cbc3d3b89af1743d9466c434e89810391c0` (also `main` on 2026-10-23; card `license: apache-2.0`, not gated). SHA-256 is each file's `lfs.oid` from `https://huggingface.co/api/models/Comfy-Org/Flux-2-Klein-4B/tree/533c4cb…/split_files/<dir>`, confirmed by the `x-linked-etag` of each `resolve/` URL.

| File | Directory | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `flux-2-klein-4b.safetensors` | `diffusion_models` | 7,751,105,712 | `ec3d4e73…bda7a343` |
| `qwen_3_4b.safetensors` | `text_encoders` | 8,044,982,048 | `6c671498…36edfc5a` |
| `flux2-vae.safetensors` | `vae` | 336,211,292 | `868fe7b3…0ce8f3` |

The URLs keep the repository's `split_files/` segment: `https://huggingface.co/Comfy-Org/Flux-2-Klein-4B/resolve/<sha>/split_files/<directory>/<file>`. The lock schema (`src/shared/server/models-lock.ts`) accepts it as is: it requires a `Comfy-Org/<repo>/resolve/<40-hex commit>/` prefix and a URL ending in `/<directory>/<file>`, and `install-models.mjs` installs by `directory`/`file`, not by URL path. No schema change was needed.

**Not from `Comfy-Org/Flux-2-Dev`.** The template's note and Comfy's docs link the VAE from `Comfy-Org/flux2-dev`, whose card is `license: other`, `license_name: flux-1-dev-non-commercial-license`. That repository's `split_files/vae/flux2-vae.safetensors` has the same name but other bytes (336,213,556 bytes, SHA-256 `d64f3a68…`, a `format: pt` header and differently named tensors), so pinning it would be both a licence problem and a different file. The Klein repository ships its own Apache-2.0 `flux2-vae.safetensors`, which the lock pins. On Comfy Cloud the lock is an expectation only: Cloud's catalog has a file named `flux2-vae.safetensors`, and this repository cannot tell which of the two it is.

`npm run check:models` prints `characterBuilder/character-generation.v1: 3 model files, 3 locked, 0 missing` and aggregates with Motion Transfer's lock without a conflict (no file is shared). Self-host sizing: about 16.1 GB of weights.

## Spike (Comfy Cloud, 2026-10-23)

The flattened graph, submitted directly with the SDK (`comfy.submit`, one job at a time), prompts set on `77:74`, seed on `77:73`, size on `77:66` and `77:62`. The submitted graph differed from the committed file only in `_meta.title` of four nodes. Latency is from the client's submit call to `job.wait()` returning; `queue_ms` and `execution_ms` are the job's own `metrics`. Cost is the account's `GET /api/billing/balance` `effective_balance_cents` read before submit and 30 s after completion (at 211 credits per dollar, as in `docs/priv/fresh-clone-2026-10-21.md`); nothing else ran on the account, but billing granularity is not documented, so treat single-job deltas as approximate.

| # | Character | Size | Seed | Job | Submit → done | Queue | Execution | Balance delta |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Full body: woman, yellow raincoat, jeans, sneakers | 768×1344 | 1001 | `cc746fe0-73ef-4c73-8584-d3a1491add2f` | 14.2 s | 2.1 s | 9.4 s | 1.160 ¢ ≈ 2.45 credits |
| 2 | Visible limbs: male dancer, tank top, joggers, red high-tops | 768×1344 | 1002 | `700d81b6-b224-44cc-9ecf-fad3cfc39ff9` | 14.2 s | 2.2 s | 8.7 s | 1.023 ¢ ≈ 2.16 credits |
| 3 | Clothing detail: elderly man, green tweed three-piece suit, paisley tie | 768×1344 | 1003 | `5960f4f5-6ac2-4f1d-a9f7-bab84b5dbe9a` | 30.9 s | 21.7 s | 5.3 s | 0.602 ¢ ≈ 1.27 credits |
| 4 | Stylized: 3D cartoon robot girl, teal hair, orange jumpsuit | 768×1344 | 1004 | `a129912b-5a7e-4c6e-ba74-1a50a682733b` | 14.6 s | 1.7 s | 8.8 s | 1.051 ¢ ≈ 2.22 credits |
| 5 | Prompt of #1, size comparison | 832×1216 | 1001 | `ce375437-c174-4f30-b5d1-ff9747e398f9` | 47.4 s | 35.7 s | 6.0 s | 0.688 ¢ ≈ 1.45 credits |

Five renders together: 4.525 ¢ ≈ 9.5 credits. Every PNG is the requested size, about 0.7–1.3 MB. Execution time on these first runs was 5–9 s; the two app renders a few minutes later executed in 1.7 s and cost about 0.12 ¢ each (below), so the spike's times likely include model loading on Cloud workers. VRAM on Cloud is not reported.

Framing, from viewing all five PNGs: each is one person, standing, facing the camera, the whole figure from the top of the head to the soles in frame, centred, on the plain background the prompt asked for, with both hands visible and apart from the body (the dancer's arms are slightly spread, as prompted). The tweed suit keeps its texture, paisley tie, pocket square, lapel pin and brogues; the stylized robot girl is a clean 3D-render character with jointed white limbs. In #1 the feet end about 60 px above the bottom edge; in #5 (832×1216) the figure takes up a smaller share of the frame and leaves more empty background at the sides.

**Default size.** Motion Transfer resizes the reference image to its render size (480×848 for a portrait clip) with a centre crop (`ResizeImageMaskNode` `672:590`, `crop: center`). A 768×1344 image (aspect 0.571) loses about 9 px of width to that crop; an 832×1216 one (0.684) would lose about 18 % of its width, at the sides where outstretched hands go. 768×1344 (multiples of 16, about 1 MP) is therefore the default. Only 768×1344 characters were animated.

## Integration smoke through the app (Comfy Cloud, 2026-10-23)

Dev server at commit `5780de5` (`vite dev`, `COMFY_BASE_URL` blank, the `.env` Cloud key, a scratch `DATABASE_PATH`), an access code minted with `scripts/mint-code.mjs`. `POST /api/character-generations` with the spike's prompts #2 and #4 and their seeds, without a size (so the default applied), polled through `GET /api/generations/:id`; each character was then saved with the characters API's `createFromGeneration({ generationId, outputName: "image", title })` and animated with `POST /api/generate` (sample motion "Street dance", blank prompt and seed, so the defaults).

| Step | Generation | Result |
| --- | --- | --- |
| Character, dancer (#2) | `8188e5de-e1dd-4a7e-a65d-ede955d2c1f7`, Cloud job `384198a7-cac0-416d-92eb-e896e8e17062` | `done` in 18.3 s (queue 13.4 s, execution 1.8 s); recipe `target: cloud`, 768×1344, seed 1002, workflow SHA-256 `8c9f3bc8885f43b768b7401ce3bf331da31a413c1669e264823cfd74ff3e0578`; `generation_outputs` `image` → asset `bde514f8-3c4d-4685-a101-2c601f949f2e` (`image/png`, 768×1344, 1,009,733 bytes); no `final_asset_id`, no poster, `provider_inputs` null; balance delta 0.122 ¢ ≈ 0.26 credits |
| Character, robot girl (#4) | `2d4dd5de-ec8e-428c-af1c-d938a476d2b9`, Cloud job `ac48c01c-5fd3-44e6-a6c7-c799b16d356a` | `done` in 7.1 s (queue 1.8 s, execution 1.7 s); asset `8540cda9-d7b3-4a5a-ad6d-4b2ac5017826` (768×1344, 717,297 bytes); 0.113 ¢ ≈ 0.24 credits |
| Pages | both | `GET /g/:id` 200 with an `<img>` of the `image` output at 768×1344; share pages `/r/b40a1eaadd9ab405` and `/r/05674af4e81c0938` 200 without a session, with the image and `og:image` |
| Save | both | characters `b192e9ce-b66e-4925-9014-30e856423c42` and `033fe66c-8e67-4cf1-8fd5-4968bc50a796`, `origin: generated`, the output's asset as image, the recipe's prompt, provenance = the recipe's workflow and the three Apache-2.0 pins |
| Animate dancer | `97172078-7d87-4346-9249-9ba4f02565ee`, Cloud job `7904126c-f4d3-420b-a0c3-8eca3529d73f` | `done` in 74.1 s; `video` → `da8daf93-0009-4047-bb67-b31b5e9507d1` (480×848, 5.017 s), `poster` → `1e818f10-a637-422e-a402-bbd74766cc93`; `/g` and `/r` 200; 8.166 ¢ ≈ 17.2 credits |
| Animate robot girl | `ff7c66bd-55cc-4fa5-b6e9-5384833f43d3`, Cloud job `21ce0db3-9e5c-4f7f-9e81-b8d6dc193227` | `done` in 95.6 s; `video` → `ab96d683-8f78-4f64-a6e9-8a5e79aea273` (480×848, 5.017 s), `poster` → `51e2affc-bbb3-4589-8dfe-57ef92a53950`; `/g` and `/r` 200; 8.324 ¢ ≈ 17.6 credits |

The app's two character PNGs have the same pixels as the spike's #2 and #4 (same prompt, seed and size); the files differ only in the workflow JSON ComfyUI embeds in the PNG. Frames at 0–4 s of both videos: the character keeps face, hair, outfit and shoe colours while performing the dance; the framing follows the driving clip (a close-up at the start, then the full body, feet included), on a white background.

## Self-host

**Not verified on selfhost**: no pod or self-host credentials were available. What is known: the classes exist at the pinned ComfyUI source, the lock aggregates without a conflict, `docker build --check` passes for both Dockerfiles, and the app image (built natively on arm64) contains this folder's `workflows/` files. Unmeasured: latency, peak VRAM (Comfy's guide, as cited in DEV-297, gives about 8.4 GB for the distilled 4B on a 5090; not checked here) and the output on that backend. Someone with a pod runs (`.claude/skills/add-new-feature/SKILL.md` sections 5–6, `docs/priv/selfhost.md`):

1. Build and push the self-host image from this commit: `docker build --platform linux/amd64 -f selfhost/Dockerfile -t <registry>/open-photon-comfy:<tag> .`; check that `docker run --rm --entrypoint ls <image> -R /opt/open-photon/src/features/characterBuilder/workflows` lists `character-generation.v1.json`, `character-generation.v1.inputs.json` and `models.lock`.
2. Start a pod from it with a volume of at least the existing models plus about 16.1 GB. The boot log must show the three files downloaded and verified (`Verified flux-2-klein-4b.safetensors`, `qwen_3_4b.safetensors`, `flux2-vae.safetensors`), `characterBuilder/character-generation.v1: 3 model files, 3 locked, 0 missing` from the preflight, and `Serving the Comfy API v2 on 0.0.0.0:8189 (auth: bearer)`.
3. `COMFY_API_KEY= COMFY_BASE_URL=https://<pod-id>-8189.proxy.runpod.net COMFY_PROXY_TOKEN=<token> npm run check:comfy` → `comfy target=selfhost …`, `OK: …`.
4. With the same environment and a scratch `DATABASE_PATH`, start the app, mint a code, and `POST /api/character-generations` `{"prompt": "<a full-body character>", "seed": 1002}`; poll `GET /api/generations/:id` to `done`. Check by hand (`scripts/verify-selfhost.mjs` checks Motion Transfer only): recipe `target: selfhost`, `workflow.sha256` equal to `shasum -a 256 character-generation.v1.json`, `models` equal to `models.lock`'s three pins, one `generation_outputs` row `image` (a 768×1344 PNG), `/g/:id` and `/r/:slug` 200.
5. Record peak VRAM during that render with the `nvidia-smi` command in `docs/priv/selfhost.md`, and the submit → done time; then save it with `createFromGeneration` and animate it once with `POST /api/generate` on the same pod.
