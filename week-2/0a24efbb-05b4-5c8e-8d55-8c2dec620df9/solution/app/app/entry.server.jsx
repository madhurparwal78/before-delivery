import { renderToString } from "react-dom/server";
import { ServerRouter } from "react-router";

export default function handleRequest(request, status, headers, context) {
  const html = renderToString(<ServerRouter context={context} url={request.url} />);
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(`<!DOCTYPE html>${html}`, { status, headers });
}
