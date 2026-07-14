import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const localNpm = path.join(rootDir, ".local-runtime", "node-v22.23.1-win-x64", "npm.cmd");
const npmCommand = process.platform === "win32" && existsSync(localNpm) ? localNpm : "npm";
const shell = true;
const backend = spawn(npmCommand, ["run", "dev:backend"], { stdio: "inherit", shell });
const frontend = spawn(npmCommand, ["run", "dev:frontend"], { stdio: "inherit", shell });

function shutdown(code = 0) {
  backend.kill();
  frontend.kill();
  process.exit(code);
}

backend.on("exit", (code) => {
  if (code && code !== 0) {
    shutdown(code);
  }
});

frontend.on("exit", (code) => {
  if (code && code !== 0) {
    shutdown(code);
  }
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
