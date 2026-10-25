import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const destination = new URL("../packages/openui-cli/dist/", import.meta.url);
mkdirSync(destination, { recursive: true });
for (const file of ["telemetry-state.cjs", "project-identity.cjs"]) {
  copyFileSync(
    fileURLToPath(new URL(`../shared/telemetry/${file}`, import.meta.url)),
    fileURLToPath(new URL(file, destination)),
  );
}
