import { handleRequest } from "../shared/core.js";
export async function onRequest(context) {
  return handleRequest(context.request, context.env, { name: "Cloudflare Pages" });
}
