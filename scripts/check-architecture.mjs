import { access, readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const workerPath = path.join(projectRoot, "workers", "app.ts");
const workerSource = await readFile(workerPath, "utf8");
const workerLines = workerSource.split("\n").length;

const failures = [];

if (workerLines > 40) {
  failures.push(`workers/app.ts has ${workerLines} lines; keep the runtime entry under 40 lines.`);
}

for (const forbiddenImport of ["drizzle-orm", "database/schema", "modules/leaderboard/service"]) {
  if (workerSource.includes(forbiddenImport)) {
    failures.push(`workers/app.ts imports application detail: ${forbiddenImport}`);
  }
}

if (!workerSource.includes("createServer") || !workerSource.includes("createRequestHandler")) {
  failures.push("workers/app.ts must compose the HTTP server and React Router request handler.");
}

for (const catchAllDirectory of ["app/shared", "src/common", "src/shared"]) {
  try {
    await access(path.join(projectRoot, catchAllDirectory));
    failures.push(`Catch-all directory is not allowed: ${catchAllDirectory}`);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

if (failures.length > 0) {
  console.error("Architecture check failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Architecture boundaries verified.");
}
