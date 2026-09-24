import http from "node:http";

let requests = 0;

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/__test/stats") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ requests }));
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"error":"not_found"}');
    return;
  }

  let bodySize = 0;
  request.on("data", (chunk) => {
    bodySize += chunk.length;
    if (bodySize > 1_000_000) request.destroy();
  });
  request.on("error", () => {});
  request.on("end", () => {
    requests += 1;
    setTimeout(() => {
      if (response.destroyed) return;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl-local-smoke",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "local-smoke-model",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({
                  verdict: "uncertain",
                  reason: "Local fake-provider Docker smoke only.",
                }),
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 17,
            completion_tokens: 8,
            total_tokens: 25,
            cost: 0.0012,
            currency: "USD",
          },
        }),
      );
    }, 1_500);
  });
});

server.listen(9191, "127.0.0.1");
