import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
function pythonRuntime() {
  const pythonOverride =
    process.env.CODESURF_PYTHON || process.env.CODETRAIL_PYTHON;
  const candidates = new Set(pythonOverride ? [pythonOverride] : ["python3"]);
  if (!pythonOverride)
    for (const dir of (process.env.PATH || "").split(path.delimiter)) {
      try {
        for (const name of fs.readdirSync(dir))
          if (/^python3\.\d+$/.test(name)) candidates.add(path.join(dir, name));
      } catch {}
    }
  const available = [];
  for (const executable of candidates) {
    try {
      const version = JSON.parse(
        execFileSync(
          executable,
          [
            "-I",
            "-S",
            "-c",
            "import sys,json;print(json.dumps(list(sys.version_info[:3])))",
          ],
          {
            encoding: "utf8",
            timeout: 5000,
            stdio: ["ignore", "pipe", "ignore"],
          },
        ),
      );
      if (version[0] === 3 && version[1] >= 10)
        available.push({ executable, version });
    } catch {}
  }
  available.sort(
    (a, b) => b.version[1] - a.version[1] || b.version[2] - a.version[2],
  );
  if (!available.length)
    throw new Error(
      "Python source requires Python 3.10+ on PATH. Set CODESURF_PYTHON to the interpreter that supports your project's syntax.",
    );
  return available[0];
}

export default {
 id:"python", names:["Python"], matches:file => /\.py[wi]?$/.test(file),
 index({roots,files}) {
  const runtime=pythonRuntime();
  const result=JSON.parse(execFileSync(runtime.executable,["-I","-S",fileURLToPath(new URL("../python_index.py",import.meta.url))],{input:JSON.stringify({roots,files}),encoding:"utf8",maxBuffer:128*1024*1024,timeout:120000}));
  return {...result,version:`${runtime.executable} (${runtime.version.join(".")})`};
 }
};
