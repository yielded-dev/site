/**
 * Cloudflare's asset layer serves `404.html` at `/404` with status 200 because
 * the file exists. Search consoles treat that as a soft 404. This worker
 * returns the same document with status 404.
 *
 * `runWorkerFirst` is limited to these paths. Every other request is delegated
 * to the asset binding, which still applies `notFoundHandling: "404-page"`.
 */

const notFoundPathnames = new Set(["/404", "/404/", "/404.html"]);

interface LandingEnv {
  readonly ASSETS: {
    fetch(input: Request): Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: LandingEnv): Promise<Response> {
    const url = new URL(request.url);

    if (!notFoundPathnames.has(url.pathname)) return env.ASSETS.fetch(request);

    const documentUrl = new URL(request.url);

    documentUrl.pathname = "/404";

    const asset = await env.ASSETS.fetch(
      new Request(documentUrl, { method: request.method, headers: request.headers }),
    );

    if (!asset.ok) return asset;

    return new Response(asset.body, {
      status: 404,
      statusText: "Not Found",
      headers: new Headers(asset.headers),
    });
  },
};
