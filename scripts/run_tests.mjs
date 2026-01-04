import { spawn } from "node:child_process";
const args = ["--test", "test/*.test.mjs"];
const child = spawn(process.execPath, args, { stdio: "inherit" });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
