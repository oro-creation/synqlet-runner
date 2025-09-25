import { join } from "jsr:@std/path";
import { Log } from "./type.ts";
import { FormValue, HttpRequest } from "./api.ts";

const fileNameMain = "main.ts";
const fileNameEntry = "entry.ts";
const fileNameResult = "result.json";

export type ExecuteResult = { type: "success"; result: unknown } | {
  type: "error";
  message: string;
} | {
  type: "timeoutError";
} | {
  type: "cancel";
};

function triggerValue(
  { triggerName, httpRequest, formValues }: {
    triggerName: string | undefined;
    httpRequest: HttpRequest | undefined;
    formValues: ReadonlyArray<FormValue> | undefined;
  },
): string {
  if (typeof triggerName !== "string") {
    return "undefined";
  }
  return `{
    name: ${JSON.stringify(triggerName)},
    ${
    httpRequest
      ? `request: {
  searchParams: new URLSearchParams(${
        JSON.stringify(
          httpRequest.searchParams.map(({ key, value }) => [key, value]),
        )
      }),
  headers: new Headers(${JSON.stringify(httpRequest.headers)}),
  jsonBody: ${JSON.stringify(httpRequest.jsonBody)},
}`
      : ""
  }${
    formValues
      ? `formValues: {${
        formValues.map(({ code, fieldType, value }) =>
          `[${JSON.stringify(code)}]: ${
            fieldType === "Date" || fieldType === "DateTime"
              ? `new Date(${value})`
              : JSON.stringify(value)
          }`
        )
      }}`
      : ""
  }
  }`;
}

/**
 * TypeScript のコードを実行
 */
export async function executeTypeScriptCode(
  { code, env, triggerName, httpRequest, formValues, timeout, signal }: {
    code: string;
    env: ReadonlyArray<{ name: string; value: string }>;
    triggerName: string | undefined;
    httpRequest: HttpRequest | undefined;
    formValues: ReadonlyArray<FormValue> | undefined;
    timeout: number;
    signal: AbortSignal;
  },
): Promise<
  {
    logStream: ReadableStream<Log>;
    resultPromise: Promise<ExecuteResult>;
  }
> {
  const codeDir = await Deno.makeTempDir();
  const fullPathResult = join(codeDir, "result.json");
  try {
    await Deno.writeTextFile(join(codeDir, fileNameMain), code);
    await Deno.writeTextFile(
      join(codeDir, fileNameEntry),
      `
import { main } from "./${fileNameMain}";

await Deno.writeTextFile("./${fileNameResult}", JSON.stringify(await main({
  env: ${JSON.stringify(Object.fromEntries(env.map((e) => [e.name, e.value])))},
  trigger: ${triggerValue({ triggerName, httpRequest, formValues })},
})));
`,
    );
    const process = new Deno.Command(Deno.execPath(), {
      cwd: codeDir,
      args: [
        "run",
        `--allow-write=./${fileNameResult}`,
        "--allow-net",
        fileNameEntry,
      ],
      stdout: "piped",
      stderr: "piped",
    }).spawn();

    let killReason: "timeout" | "cancel" | undefined = undefined;
    const kill = () => {
      try {
        process.kill();
      } catch {
        // プロセスがすでに終了しているか kill に失敗
      }
    };
    const killBySignal = () => {
      killReason = "cancel";
      kill();
    };
    signal.addEventListener("abort", killBySignal);
    const timeoutId = setTimeout(() => {
      killReason = "timeout";
      kill();
    }, timeout);

    return {
      logStream: createLogStream(process),
      resultPromise: process.status.then(async (status) => {
        try {
          clearTimeout(timeoutId);
          signal.removeEventListener("abort", killBySignal);
          if (killReason === "timeout") {
            return { type: "timeoutError" };
          }
          if (killReason === "cancel") {
            return { type: "cancel" };
          }
          if (status.success) {
            const result = JSON.parse(await Deno.readTextFile(fullPathResult));
            return { type: "success", result };
          } else {
            return {
              type: "error",
              message: `プロセスがコード「${status.code}」で終了しました`,
            };
          }
        } catch (e) {
          return {
            type: "error",
            message: `結果の読み取りに失敗しました: ${e}`,
          };
        } finally {
          await Deno.remove(codeDir, { recursive: true });
        }
      }),
    };
  } catch (e) {
    await Deno.remove(codeDir, { recursive: true });
    return {
      logStream: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      resultPromise: Promise.resolve<ExecuteResult>({
        type: "error",
        message:
          `denoコマンドでプロセスを操作しているときにエラーが発生しました ${e}`,
      }),
    };
  }
}

function createLogStream(process: Deno.ChildProcess): ReadableStream<Log> {
  return new ReadableStream<Log>({
    async start(controller) {
      try {
        const stdoutTextStream = process.stdout.pipeThrough(
          new TextDecoderStream(),
        );
        const stderrTextStream = process.stderr.pipeThrough(
          new TextDecoderStream(),
        );
        await Promise.all([
          (async () => {
            for await (const text of stdoutTextStream) {
              controller.enqueue({
                from: "Stdout",
                loggedAt: new Date().toISOString(),
                text,
              });
            }
          })(),
          (async () => {
            for await (const text of stderrTextStream) {
              controller.enqueue({
                from: "Stderr",
                loggedAt: new Date().toISOString(),
                text,
              });
            }
          })(),
        ]);
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
}
