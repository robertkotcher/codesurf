import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const chrome = process.env.CODESURF_CHROME || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].find((p) => fs.existsSync(p));

test("captures the demo checkout with the clicked button measured", { skip: !chrome && "Chrome is not installed" }, async () => {
  const { server } = await import("../examples/demo-shop/server.mjs");
  const { shoot } = await import("../src/shot.js");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codesurf-shot-"));
  try {
    const result = await shoot({ url, out: path.join(dir, "a.png"), after: path.join(dir, "b.png"), viewport: { width: 900, height: 640 },
      steps: [{ select: "#card", value: "demo-declined" }], highlight: ["#pay"], labels: ["Pay now"],
      then: [{ click: "#pay" }, { waitFor: "#result.error" }] });
    assert.deepEqual(result.highlights[0], { x: 240, y: 368, width: 420, height: 40, label: "Pay now", selector: "#pay" });
    assert.ok(fs.statSync(path.join(dir, "a.png")).size > 1000);
    assert.ok(fs.statSync(path.join(dir, "b.png")).size > 1000);
  } finally {
    server.close();
  }
});
