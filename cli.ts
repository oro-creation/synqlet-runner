import { Command } from "@cliffy/command";

import { runner } from "./mod.ts";

await new Command()
  .name("dxeco-runner")
  .version("v0.0.1")
  .option("--runner-key <runnerKey>", "Runner Key", {
    required: true,
  })
  .option("--api-url <apiUrl>", "API URL", {
    required: true,
  })
  .option("--interval <interval:number>", "Jobs polling interval (ms)", {
    default: 30000,
  })
  .option("--timeout <timeout:number>", "Timeout (ms)", {
    default: 300000,
  })
  .action(async ({ runnerKey, apiUrl, interval, timeout }) => {
    await runner({
      runnerKey,
      apiUrl: new URL(apiUrl),
      interval,
      timeout,
    });
  })
  .parse();
