import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const localStorageFile =
  process.env.YAGODKA_LOCALSTORAGE_FILE ||
  path.join(os.tmpdir(), "yagodka-localstorage.json");

const args = [`--localstorage-file=${localStorageFile}`, "--test", "test/*.test.mjs"];
const child = spawn(process.execPath, args, { stdio: "inherit" });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
