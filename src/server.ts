import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function applySecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  if (!headers.has("X-Frame-Options")) {
    headers.set("X-Frame-Options", "SAMEORIGIN");
  }
  if (!headers.has("X-Content-Type-Options")) {
    headers.set("X-Content-Type-Options", "nosniff");
  }
  if (!headers.has("Referrer-Policy")) {
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  }
  if (!headers.has("Strict-Transport-Security")) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  if (!headers.has("Permissions-Policy")) {
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  }
  if (!headers.has("Content-Security-Policy")) {
    headers.set(
      "Content-Security-Policy",
      "default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self';"
    );
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);
      return applySecurityHeaders(normalized);
    } catch (error) {
      console.error(error);
      const errResponse = new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
      return applySecurityHeaders(errResponse);
    }
  },
};
