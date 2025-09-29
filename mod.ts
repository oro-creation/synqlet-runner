import {
  activateRunner,
  getCurrentRunner,
  getPendingRunnerJobs,
  getRunnerJob,
  updateRunnerJob,
} from "./api.ts";
import { getLogger } from "jsr:@std/log";
import { delay } from "jsr:@std/async";
import { Table } from "jsr:@cliffy/table@^1.0.0-rc.8";
import { executeTypeScriptCode } from "./execute.ts";
import { Log } from "./type.ts";

export async function runner(
  { runnerKey, apiUrl, interval = 30000, timeout = 300000 }: Readonly<{
    runnerKey: string;
    apiUrl: URL;
    /**
     * Jobs polling interval
     * @default 30000
     */
    interval?: number | undefined;
    /**
     * timeout
     * @default 300000
     */
    timeout?: number;
  }>,
): Promise<void> {
  const logger = getLogger();
  const currentRunner = await getCurrentRunner({ apiUrl, runnerKey });

  new Table(
    ["id", currentRunner.id],
    ["name", currentRunner.name],
    [
      "url",
      new URL(
        `/o/${currentRunner.organizationId}/runners/${currentRunner.id}`,
        apiUrl,
      ).toString(),
    ],
  ).render();

  // Activate every 30 seconds
  setInterval(async () => {
    await activateRunner({
      apiUrl,
      runnerKey,
      runnerId: currentRunner.id,
      logger,
    });
  }, 30000);

  logger.info(`Waiting for jobs...`);

  // Polls its own jobs every 30 seconds
  while (true) {
    const { data: jobs } = await getPendingRunnerJobs({
      runnerKey,
      apiUrl,
      runnerId: currentRunner.id,
      logger,
    });

    if (jobs.length > 0) {
      logger.info(`Jobs found: ${jobs.map((v) => v.id).join(", ")}`);
    }

    for (const job of jobs) {
      try {
        logger.info(`Job started`);
        new Table(
          ["id", job.id],
          [
            "url",
            new URL(
              `/o/${currentRunner.organizationId}/runner-jobs/${job.id}`,
              apiUrl,
            ).toString(),
          ],
        ).render();

        await updateRunnerJob({
          apiUrl,
          runnerKey,
          runnerJobId: job.id,
          status: "Running",
        });

        if (!job.code) {
          throw new Error("Runnable code not found");
        }

        const abortController = new AbortController();

        console.log(job);

        const { logStream, resultPromise } = await executeTypeScriptCode({
          code: job.code,
          timeout,
          signal: abortController.signal,
          env: job.environmentVariables,
          triggerName: job.trigger?.name,
          httpRequest: job.httpRequest,
          formValues: job.formValues,
        });

        await updateLogsAndCheckCancel({
          apiUrl,
          runnerKey,
          runnerJobId: job.id,
          logStream,
          onCancel: () => {
            abortController.abort();
          },
        });

        const result = await resultPromise;

        logger.info(`Job ${result.type}`);

        await updateRunnerJob({
          apiUrl,
          runnerKey,
          runnerJobId: job.id,
          status: ({
            success: "Done",
            error: "Error",
            timeoutError: "Timeout",
            cancel: "CancelDone",
          } as const)[result.type],
          errorReason: result.type === "error" ? result.message : undefined,
          result: result.type === "success" ? result.result : undefined,
        });
      } catch (e) {
        logger.error(`Job error: ${e}`);
        if (e instanceof Error) {
          logger.info(`Job error: ${e.message}`);

          try {
            await updateRunnerJob({
              apiUrl,
              runnerKey,
              runnerJobId: job.id,
              status: "Error",
              errorReason: e.stack,
            });
          } catch (e) {
            logger.error(`Failed to update runner jobs: ${e}`);
          }
        }
      }
    }

    await delay(interval);
  }
}

/**
 * ログの変更を反映もしくはステータスを確認する時間の間隔 (ミリ秒)
 */
const LOOP_TIME = 1000;

async function updateLogsAndCheckCancel(
  { apiUrl, runnerKey, runnerJobId, logStream, onCancel }: {
    apiUrl: URL;
    runnerKey: string;
    runnerJobId: string;
    logStream: ReadableStream<Log>;
    onCancel: () => void;
  },
): Promise<void> {
  const logs: Log[] = [];
  let logUpdate: boolean = false;

  const loop = async () => {
    if (logUpdate) {
      const { status } = await updateRunnerJob({
        apiUrl,
        runnerKey,
        runnerJobId,
        logs,
      });
      if (status === "CancelPending") {
        onCancel();
      }
      logUpdate = false;
    } else {
      const { status } = await getRunnerJob({ apiUrl, runnerKey, runnerJobId });
      if (status === "CancelPending") {
        onCancel();
      }
    }
    timeoutId = setTimeout(loop, LOOP_TIME);
  };

  let timeoutId = setTimeout(loop, LOOP_TIME);

  for await (const log of logStream) {
    logs.push(log);
    logUpdate = true;
  }
  clearTimeout(timeoutId);
  await updateRunnerJob({
    apiUrl,
    runnerKey,
    runnerJobId,
    logs,
  });
}
