// Writes workflows/xolotl.api.json, the workflow for ComfyUI without the app, from the template (lib/swap.ts
// standaloneWorkflow): node --experimental-strip-types scripts/standalone.ts
import { readFileSync, writeFileSync } from "node:fs";
import { standaloneWorkflow, type Graph } from "../lib/swap.ts";

const template = JSON.parse(readFileSync(new URL("../workflows/swap.api.json", import.meta.url), "utf8")) as Graph;
writeFileSync(new URL("../workflows/xolotl.api.json", import.meta.url), `${JSON.stringify(standaloneWorkflow(template), null, 2)}\n`);
console.log("workflows/xolotl.api.json written");
