# Upload memory investigation — 20 October 2026

The increased memory is real, but the evidence points to short-lived upload buffers waiting
for V8 garbage collection, rather than upload data accumulating behind a slow file writer.
The native AMD64 failure is reproducible. The earlier conclusion that this was confined to
Colima was incorrect.

## What was measured

The historical experiments built each revision's Dockerfile on GitHub `ubuntu-latest`
with `--platform linux/amd64`, verified `uname -m = x86_64`, and used fresh container volumes.
The application runtime was Node 24.19.0. The original six-upload harness and its three
64 MiB limits were retained for each revision. No production deployment was changed.

The first attempts to run historical CI stopped at its privacy check: the old checker
rejected `.env.example` on newer refs fetched by checkout. The subsequent diagnostic
workflow checked out each subject separately and ran the production build, access check,
and memory harness. These runs are memory experiments, not full historical CI passes.

Experiments and their source are retained on the `codex/upload-memory-investigation`
branch. Downloaded reports and container traces are in `work/upload-investigation/`.

| Experiment | GitHub run |
| --- | --- |
| Baseline, Phase 3, Phase 6, current, queue/GC instrumentation | [39433128319](https://github.com/WojciechJelen/open-photon/actions/runs/39433128319) |
| End of Phase 6, Steps 7.1/7.2, final fixes, forced-GC control | [39433492055](https://github.com/WojciechJelen/open-photon/actions/runs/39433492055) |
| V8-only traces and four simultaneous uploads | [39433757076](https://github.com/WojciechJelen/open-photon/actions/runs/39433757076) |
| Repeat adjacent revisions; form-login control | [39433851146](https://github.com/WojciechJelen/open-photon/actions/runs/39433851146) |
| Remaining intermediate upload-path revisions | [39434029162](https://github.com/WojciechJelen/open-photon/actions/runs/39434029162) |
| Young-generation sizing experiments | [39434255141](https://github.com/WojciechJelen/open-photon/actions/runs/39434255141) |

## Where the bytes are

The temporary preload intercepted `Readable.toWeb` and sampled the existing streams'
queue lengths and the file writer's `bytesWritten`, without attaching a consuming
`data` listener. It also observed GC events.

- No upload request was converted to a web stream in the traced runs. The Node request
  had no `data` listener competing with its async iterator.
- At 10 MiB/s, the sampled sum of stream queue lengths never exceeded 65,536 bytes.
  The largest received-minus-written difference was 65,710 bytes, including 174 bytes
  of multipart framing.
- In one sample, `arrayBuffers` was **32,937,269 bytes**, every queue was empty, and
  **32,636,754 of 32,636,928 received bytes** had already been written.
  The next GC event reported **282,726 bytes** of array buffers.
- In a separate forced-GC diagnostic, buffers fell from **17,224,185 to 217,225 bytes**
  while the upload was still in progress. Forced GC was an experiment only.
- Unthrottled uploads filled the bounded queues: the sum of readable/writable lengths
  reached 589,824 bytes, with 393,390 bytes between receiving and writing. The sum
  double-counts some chunks held by adjacent stages, so it is not distinct allocated memory.

The preload changed startup allocation and reduced the cold peak to about 32 MiB.
Therefore its memory-gate passes are not evidence that the unchanged application passes.
A second experiment used only Node's `--trace-gc`, with no JavaScript preload or forced GC.
It reproduced the cold failures, with buffer peaks of 59.2 and 57.7 MiB. In its first
cold process, major collections were separated by approximately 5.9 seconds
(1,807 ms to 7,703 ms since process start), during which consumed buffers accumulated.

V8's startup heap growth and collection timing differ between revisions and runs.
The current trace grew the heap capacity to roughly 56 MiB during startup; the baseline
trace was around 35 MiB at the corresponding point. The samples then show the characteristic
rise and sudden drop in buffers, followed by much smaller warm peaks.

`arrayBuffers` counts allocated backing storage, including Node Buffers; it does not
identify queued or reachable bytes. RSS can also stay high after collection because
the allocator retains memory. See the [Node memory documentation](https://nodejs.org/docs/latest-v24.x/api/process.html#processmemoryusage).

## Commit attribution

`9e8f70c` (Step 7.1, access codes) is the earliest revision observed failing in these
measurements. Its immediate parent, `87c80d1`, passed twice. However, Step 7.1 itself
also passed on repetition. This is not a deterministic green/red boundary suitable for
an ordinary one-run `git bisect`, and it does not identify a faulty line in the access code.

The earlier tested revisions `6ffd68d`, `ae6b1d6`, `8506016`, `d7d680f`, `739b537`,
and `c6bf929` passed their six-run checks. `9dedc85` and `6d2428e` failed;
`9687810` passed its sampled run. The current `c30747c` failed both its ordinary run
and the V8-only trace. The variation at intermediate commits is part of the evidence,
not grounds for dismissing the current failures.

`846a4f8` could not be classified by its original harness: it had removed
`/api/spike/status`, and `/api/debug/streams` arrived in the following commit.
Its readiness loop therefore timed out before measuring an upload.

Step 7.1 also changed the harness from a form login to JSON login. Restoring form login
against the same images did not reliably remove failures. Phase 3's SHA-256 transform,
asset storage and ffprobe were already present in a passing revision. The source audit
and runtime trace do not support an early upload-body read by CSRF, access, or rate limiting.

## Runtime change

The Docker command now sets `--max-semi-space-size=4`. This limits a V8 semi-space
to 4 MiB; it is not a 4 MiB limit on the whole process or on its buffers.
Smaller young generations collect short-lived objects sooner, at the cost of more
frequent GC. The [Node option documentation](https://github.com/nodejs/node/blob/v24.19.0/doc/api/cli.md#--max-semi-space-sizesize-in-mib)
describes this memory/throughput tradeoff and the dependence of defaults on memory limits.

The unchanged current image, started with this flag, passed all six native measurements:

| Run | State / rate | Anon growth (MiB) | App RSS growth (MiB) | Buffers peak (MiB) |
| --- | --- | ---: | ---: | ---: |
| 1 | cold / `10M` | 11.1 | 11.2 | 9.8 |
| 2 | warm / `10M` | 1.1 | 1.1 | 9.9 |
| 3 | cold / unthrottled | 22.3 | 19.4 | 17.1 |
| 4 | warm / unthrottled | 5.6 | 5.6 | 11.6 |
| 5 | cold / `10M` | 15.7 | 9.7 | 9.8 |
| 6 | warm / `10M` | 5.1 | 1.2 | 9.8 |

An 8 MiB semi-space was also tested twice. It reduced the cold capped buffer peaks to
about 37 MiB, but one unthrottled run still exceeded the anonymous-memory limit.
It was not selected. The production change does not expose or force GC, raise any
threshold, or add warm-up work to the memory check.

CI now preserves the full sample report even on failure, and the report records the
Node version. This makes future changes assessable beyond six peak summaries.

## Limits and concurrent uploads

The originally reported 61.8–63.0 **MB** buffer peaks are below 64 **MiB**
(67,108,864 bytes). Those failures exceeded anonymous-memory and application-RSS limits,
not all three limits. The guard still detects a real transient memory cost.

A separate current-image experiment completed four simultaneous 100 MiB uploads, each
capped at 10 MiB/s, after a cold restart and small warm-up upload. Aggregate peaks were
71.85 MiB anonymous growth, 72.21 MiB application-RSS growth, and 60.21 MiB array buffers.
The four requests used the same padded input and were deduplicated after receipt.
This does not support multiplying the single-request garbage peak by four: GC acts on
the whole process. It is one native-runner observation, not a Railway capacity guarantee.

Railway was not load-tested. Its 1 GB budget also covers the existing application, file
cache and media subprocesses. The per-client/per-code rate limits are not an instance-wide
upload concurrency bound. A production capacity claim still needs measurement on that
deployment with distinct inputs and representative concurrent work.
