import { spawn } from "node:child_process";

const shell = process.platform === "win32";
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const devEnv = { ...process.env, NODE_ENV: "development", ZHIHU_DEV_USER_DATA: "1" };
const children = [
  spawn(command, ["dev:api"], { stdio: "inherit", shell, env: devEnv }),
  spawn(command, ["dev:workbench"], { stdio: "inherit", shell, env: devEnv }),
];

const stop = () => {
  for (const child of children) child.kill();
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
  });
}
