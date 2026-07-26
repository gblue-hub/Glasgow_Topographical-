import type { Plugin } from "vite";

export function osrmProxy(
  targetBaseUrl = process.env.OSRM_BASE_URL || "http://127.0.0.1:5000",
  fallbackBaseUrl =
    process.env.OSRM_FALLBACK_URL || "https://router.project-osrm.org",
): Plugin {
  return {
    name: "local-osrm-proxy",
    configureServer(server) {
      server.middlewares.use("/api/osrm", (request, response, next) => {
        if (request.method !== "GET") return next();
        const target = `${targetBaseUrl.replace(/\/$/, "")}${request.url ?? ""}`;
        const fetchRoute = (url: string) =>
          fetch(url, { headers: { Accept: "application/json" } });
        void fetchRoute(target)
          .catch(() =>
            fetchRoute(
              `${fallbackBaseUrl.replace(/\/$/, "")}${request.url ?? ""}`,
            ),
          )
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
                message:
                  "Routing is temporarily unavailable from both the local and fallback services.",
                detail: error.message,
              }),
            );
          });
      });
    },
  };
}
