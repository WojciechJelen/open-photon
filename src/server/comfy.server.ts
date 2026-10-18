import { Comfy, ComfyError, NotFound } from "@comfyorg/sdk";

export async function checkComfySdk() {
  if (!process.env.COMFY_API_KEY && !process.env.COMFY_BASE_URL) {
    return Response.json(
      {
        kind: "missing-key",
        message: "Set the server runtime credential to verify Comfy authentication",
      },
      { status: 503 },
    );
  }

  try {
    const client = new Comfy();
    await client.jobs.get("nonexistent");

    return Response.json({ kind: "unexpected-success" }, { status: 502 });
  } catch (error) {
    if (error instanceof NotFound) {
      return Response.json({
        httpStatus: error.httpStatus,
        kind: "not-found",
        sdkError: error.name,
      });
    }

    return Response.json(
      {
        httpStatus: error instanceof ComfyError ? error.httpStatus : null,
        kind: "unexpected-error",
        sdkError: error instanceof Error ? error.name : "UnknownError",
      },
      { status: 502 },
    );
  }
}
