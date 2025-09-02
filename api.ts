import { Logger } from "jsr:@std/log";
import ky from "npm:ky";
import { Log } from "./type.ts";

/**
 * ランナー自分自身を取得する
 * @see
 */
export async function getCurrentRunner({ apiUrl, runnerKey }: {
  apiUrl: URL;
  runnerKey: string;
}): Promise<{
  id: string;
  name: string;
  organizationId: string;
}> {
  const res = await ky.get("runners/current", {
    prefixUrl: apiUrl,
    headers: { "X-RUNNER-Key": runnerKey },
  });
  return await res.json();
}

/**
 * ランナーアクティブ化
 * エラー発生時はloggerに出力
 * @see https://api.dxeco.io/docs#tag/runner/operation/RunnerController_activateRunner
 */
export async function activateRunner({ apiUrl, runnerKey, runnerId, logger }: {
  apiUrl: URL;
  runnerKey: string;
  runnerId: string;
  logger: Logger;
}): Promise<void> {
  try {
    await ky.post(
      `runners/${runnerId}/activate`,
      {
        prefixUrl: apiUrl,
        headers: {
          "X-RUNNER-Key": runnerKey,
        },
      },
    );
  } catch (error) {
    logger.error(`Failed to activate runner: ${error}`);
  }
}

export type HttpRequest = {
  searchParams: ReadonlyArray<{ key: string; value: string }>;
  headers: Record<string, string>;
  jsonBody: unknown;
};

/**
 * ランナージョブ一覧
 * エラー発生時は空配列を返し、loggerに出力
 */
export async function getPendingRunnerJobs(
  { apiUrl, runnerKey, runnerId, logger }: {
    apiUrl: URL;
    runnerKey: string;
    runnerId: string;
    logger: Logger;
  },
): Promise<{
  data: ReadonlyArray<{
    id: string;
    status: string;
    code: string;
    environmentVariables: ReadonlyArray<{
      name: string;
      value: string;
    }>;
    trigger?: {
      name: string;
    };
    httpRequest?: HttpRequest;
  }>;
}> {
  try {
    // なぜか fetch を使うと connection closed before message completed ERRORが出るため ky で代用
    const res = ky.get("runner-jobs", {
      prefixUrl: apiUrl,
      searchParams: {
        filter: JSON.stringify({
          runnerId: { eq: runnerId },
          status: { eq: "Pending" },
        }),
        // relations: JSON.stringify([{ name: "trigger" }]),
      },
      headers: { "X-RUNNER-Key": runnerKey },
    });
    return await res.json();
  } catch (e) {
    logger.error(`Failed to get runner jobs: ${e}`);
    return { data: [] };
  }
}

/**
 * ランナージョブ詳細
 */
export async function getRunnerJob(
  { apiUrl, runnerKey, runnerJobId }: {
    apiUrl: URL;
    runnerKey: string;
    runnerJobId: string;
  },
): Promise<{ status: "Running" | "CancelPending" }> {
  return await (await ky.get(`runner-jobs/${runnerJobId}`, {
    prefixUrl: apiUrl,
    headers: {
      "X-RUNNER-Key": runnerKey,
    },
  })).json();
}

/**
 * ランナージョブ更新
 */
export async function updateRunnerJob(
  { apiUrl, runnerKey, runnerJobId, status, errorReason, result, logs }: {
    apiUrl: URL;
    runnerKey: string;
    runnerJobId: string;
    status?:
      | "Running"
      | "Done"
      | "Error"
      | "Timeout"
      | "CancelDone"
      | undefined;
    errorReason?: string | undefined;
    result?: unknown;
    logs?: ReadonlyArray<Log>;
  },
): Promise<{ status: "Running" | "CancelPending" }> {
  return await (await ky.put(`runner-jobs/${runnerJobId}`, {
    prefixUrl: apiUrl,
    headers: {
      "X-RUNNER-Key": runnerKey,
    },
    json: {
      id: runnerJobId,
      status,
      errorReason,
      result,
      logs,
    },
  })).json();
}
