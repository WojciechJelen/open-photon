import { createServer } from "node:http";

createServer((request, response) => {
  const authenticated =
    request.headers.authorization === "Bearer spike-runtime-canary-not-a-real-key";

  const expected = request.url === "/api/v2/jobs/nonexistent";
  response.writeHead(authenticated && expected ? 404 : 401, {
    "Content-Type": "application/json",
  });
  response.end(
    JSON.stringify({
      error: {
        code: authenticated && expected ? "not_found" : "unauthorized",
        message: "Local SDK contract fixture",
      },
    }),
  );
}).listen(9090, "0.0.0.0");
