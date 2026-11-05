import { handleRequest } from "../shared/core.js";

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, { name: "Cloudflare Workers" });
  }
};
