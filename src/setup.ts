import fs from "node:fs";
import path from "node:path";
import { ensureWorkspace, paths } from "./config.js";

export function runSetup() {
  ensureWorkspace();

  const example = path.join(paths.root, ".env.example");
  const envPath = paths.envFile;

  if (!fs.existsSync(envPath)) {
    fs.copyFileSync(example, envPath);
    console.log(`Created ${envPath}`);
  } else {
    console.log(`.env already exists at ${envPath}`);
  }

  console.log("\nWorkspace ready:");
  console.log(`  ${paths.jobs}`);
  console.log("\nPaste OPENROUTER_API_KEY into .env when ready.");
  console.log('Then run: npm run clip -- "https://www.youtube.com/watch?v=..."');
}

export function saveOpenRouterKey(key: string) {
  let env = fs.existsSync(paths.envFile) ? fs.readFileSync(paths.envFile, "utf-8") : "";
  if (/^OPENROUTER_API_KEY=/m.test(env)) {
    env = env.replace(/^OPENROUTER_API_KEY=.*$/m, `OPENROUTER_API_KEY=${key}`);
  } else {
    env = `${env.trimEnd()}\nOPENROUTER_API_KEY=${key}\n`;
  }
  fs.writeFileSync(paths.envFile, env, "utf-8");
}
