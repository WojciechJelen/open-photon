// node scripts/verify-image-pair.mjs <version> <source commit> [registry owner]
// Anonymous reads only. The JSON output is the public release's image-pair.json attachment.
import assert from "node:assert/strict";

const [version, sourceCommit, owner = "wojciechjelen"] = process.argv.slice(2);

assert.match(version ?? "", /^\d+\.\d+\.\d+$/u, "Supply a release version");

assert.match(sourceCommit ?? "", /^[a-f0-9]{40}$/u, "Supply the full source commit");

assert.match(owner, /^[a-zA-Z0-9-]+$/u, "Supply a registry owner");

const images = [];

const accept = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

for (const image of ["open-photon", "open-photon-comfy"]) {
  const repository = `${owner.toLowerCase()}/${image}`;
  const query = new URLSearchParams({ service: "ghcr.io", scope: `repository:${repository}:pull` });

  const auth = await fetch(`https://ghcr.io/token?${query}`, {
    signal: AbortSignal.timeout(30_000),
  });

  assert.ok(auth.ok, `Anonymous registry access failed: HTTP ${auth.status}`);

  const { token } = await auth.json();

  assert.ok(/^[A-Za-z0-9._~+/-]+=*$/u.test(token), "Registry did not issue anonymous pull access");

  async function read(kind, reference) {
    const response = await fetch(
      `https://ghcr.io/v2/${repository}/${kind}/${encodeURIComponent(reference)}`,
      {
        headers: { Accept: accept, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      },
    );

    assert.ok(response.ok, `${repository}/${reference}: HTTP ${response.status}`);

    return { data: await response.json(), digest: response.headers.get("docker-content-digest") };
  }

  const index = await read("manifests", version);

  assert.match(index.digest ?? "", /^sha256:[a-f0-9]{64}$/u);
  assert.ok(Array.isArray(index.data.manifests), `${image} must publish a platform index`);

  const platforms = [];

  for (const entry of index.data.manifests) {
    if (entry.platform?.os !== "linux") {
      continue;
    }

    assert.match(entry.digest, /^sha256:[a-f0-9]{64}$/u);

    const manifest = await read("manifests", entry.digest);
    const config = await read("blobs", manifest.data.config.digest);
    const revision = config.data.config.Labels["org.opencontainers.image.revision"];

    assert.equal(config.data.architecture, entry.platform.architecture);
    assert.equal(config.data.os, "linux");
    assert.equal(
      revision,
      sourceCommit,
      `${image}/${entry.platform.architecture}: source mismatch`,
    );
    platforms.push({
      architecture: entry.platform.architecture,
      digest: entry.digest,
      os: "linux",
      revision,
    });
  }

  assert.deepEqual(
    platforms
      .map((platform) => platform.architecture)
      .sort((left, right) => left.localeCompare(right)),
    image === "open-photon" ? ["amd64", "arm64"] : ["amd64"],
    `${image}: unexpected platforms`,
  );
  images.push({ digest: index.digest, image: `ghcr.io/${repository}:${version}`, platforms });
}

console.log(
  JSON.stringify({ anonymousPullVerified: true, images, sourceCommit, version }, null, 2),
);
