import { runner } from "./mod.ts";

runner({
  // 書き換えて実行、コミットしない
  runnerKey: "dummyRunnerKey",
  apiUrl: new URL("https://localhost:3000/api"),
  interval: 2000,
});
