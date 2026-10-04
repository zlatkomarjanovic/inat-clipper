import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runSetup, saveOpenRouterKey } from "./setup.js";

async function main() {
  runSetup();
  const rl = readline.createInterface({ input, output });
  try {
    const key = (await rl.question("\nOpenRouter API key (leave empty to skip): ")).trim();
    if (key) {
      saveOpenRouterKey(key);
      console.log("Saved OPENROUTER_API_KEY to .env");
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
