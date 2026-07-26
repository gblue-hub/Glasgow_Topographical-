import type { Plugin } from "vite";

export function osrmProxy(
  targetBaseUrl = process.env.OSRM_BASE_URL || "http://127.0.0.1:5000",
): Plugin {
  return {
    name: "local-osrm-proxy",
    configureServer(server) {
      server.middlewares.use("/api/osrm", (request, response, next) => {
        if (request.method !== "GET") return next();
        const target = `${targetBaseUrl.replace(/\/$/, "")}${request.url ?? ""}`;
        void fetch(target, {
          headers: { Accept: "application/json" },
        })
          .then(async (routeResponse) => {
            response.statusCode = routeResponse.status;
            response.setHeader(
              "Content-Type",
              routeResponse.headers.get("content-type") ?? "application/json",
            );
            response.setHeader("Cache-Control", "no-store");
            response.end(Buffer.from(await routeResponse.arrayBuffer()));
          })
          .catch((error: Error) => {
            response.statusCode = 502;
            response.setHeader("Content-Type", "application/json");
            response.end(
              JSON.stringify({
                code: "RoutingServiceUnavailable",
                message: `Unable to reach local OSRM at ${targetBaseUrl}: ${error.message}`,
              }),
            );
          });
      });
    },
  };
}
