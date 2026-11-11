import { generators } from "arri";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const defPath = path.resolve(rootDir, ".output/__definition.json");

if (!fs.existsSync(defPath)) {
  console.error(`Definition file not found at ${defPath}`);
  process.exit(1);
}

const appDef = JSON.parse(fs.readFileSync(defPath, "utf8"));

let genConfigs = [];
if (process.argv[2]) {
  try {
    genConfigs = JSON.parse(process.argv[2]);
  } catch (e) {
    console.warn("Could not parse generator config JSON passed as CLI argument, using default config.");
  }
}

if (!genConfigs || genConfigs.length === 0) {
  genConfigs = [
    { name: "typescript", client_name: "AvatarArriClient", output_file: "avarar-creator/src/services/arri_client.rpc.ts" },
    { name: "dart", client_name: "ArriClient", output_file: "frontend/lib/services/arri_client.rpc.dart" },
  ];
}

const activeGenerators = [];

for (const g of genConfigs) {
  const name = g.name || g.type;
  const clientName = g.client_name || g.clientName || "ArriClient";
  const outputFile = path.resolve(rootDir, g.output_file || g.outputFile);
  const outDir = path.dirname(outputFile);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  if (name === "typescript" || name === "ts") {
    activeGenerators.push(generators.typescriptClient({ clientName, outputFile }));
  } else if (name === "dart") {
    activeGenerators.push(generators.dartClient({ clientName, outputFile }));
  }
}

if (activeGenerators.length > 0) {
  console.log(`⚡ Running ${activeGenerators.length} client generator(s) from arri.config.py...`);
  await Promise.all(activeGenerators.map((g) => g.run(appDef, false)));
  console.log("✅ Client codegen complete!");
}
