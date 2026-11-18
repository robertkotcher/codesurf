// A tiny demo shop: serves the checkout page and handles POST /checkout.
import http from "node:http";
import fs from "node:fs";
import { handleCheckout } from "./checkout.mjs";

const page = fs.readFileSync(new URL("./public/index.html", import.meta.url));
const script = fs.readFileSync(new URL("./public/cart.js", import.meta.url));

export const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/checkout") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const result = await handleCheckout(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: result.status, total: result.reservation.total }));
    } catch (error) {
      res.writeHead(402, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  if (req.url === "/cart.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    return res.end(script);
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(page);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 4400);
  server.listen(port, "127.0.0.1", () => console.log(`Demo shop on http://127.0.0.1:${port}`));
}
