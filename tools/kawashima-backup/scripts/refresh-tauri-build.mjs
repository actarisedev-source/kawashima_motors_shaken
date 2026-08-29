import { statSync, utimesSync } from "node:fs";
import { fileURLToPath } from "node:url";

const buildScript = fileURLToPath(new URL("../src-tauri/build.rs", import.meta.url));
const metadata = statSync(buildScript);
const now = new Date();
utimesSync(buildScript, metadata.atime, now);
