import { handleRequest } from "../shared/core.js";
export default function onRequest(context) {
  return handleRequest(context.request, context.env, {
    name: "EdgeOne Makers",
    eo: context.request.eo || {}
  });
}
