import assert from "node:assert/strict";
import axios from "axios";
import type { AccountDoc } from "@/lib/types";

function axiosError(
  status: number | undefined,
  data?: unknown,
): InstanceType<typeof axios.AxiosError> {
  return new axios.AxiosError(
    "request failed",
    status ? "ERR_BAD_RESPONSE" : "ECONNRESET",
    undefined,
    undefined,
    status
      ? {
          status,
          statusText: "Error",
          headers: {},
          config: { headers: {} } as never,
          data,
        }
      : undefined,
  );
}

const account = {
  id: "threads_test",
  platform: "threads",
  handle: "test_account",
  display_name: "Test",
  connected: true,
  scopes: [],
  token_meta: { access_token: "token", user_id: "user" },
  created_at: "2026-09-02T00:00:00.000Z",
  updated_at: "2026-09-02T00:00:00.000Z",
} satisfies AccountDoc;

async function main() {
  process.env.THREADS_RECONCILIATION_INTERVAL_MS = "0";
  const {
    ThreadsPublishError,
    classifyThreadsApiError,
    publishThreadsPost,
    findThreadsReplyByContent,
  } = await import("@/lib/platforms/threads");

  const mediaNotFound = axiosError(400, {
    error: {
      code: 24,
      error_subcode: 4279009,
      message: "Media Not Found",
      is_transient: false,
    },
  });
  assert.deepEqual(classifyThreadsApiError("publish", mediaNotFound), {
    stage: "publish",
    kind: "media_not_found",
    status: 400,
    code: 24,
    subcode: 4279009,
    isTransient: false,
  });

  const originalPost = axios.post;
  const originalGet = axios.get;
  try {
    let createCount = 0;
    let publishCount = 0;
    const stages: string[] = [];
    axios.get = (async () => ({ data: { status: "FINISHED" } })) as typeof axios.get;
    axios.post = (async (url: string) => {
      if (url.endsWith("/threads_publish")) {
        publishCount += 1;
        if (publishCount === 1) throw mediaNotFound;
        return { data: { id: "published-2" } };
      }
      createCount += 1;
      return { data: { id: `container-${createCount}` } };
    }) as typeof axios.post;

    const replaced = await publishThreadsPost(
      account,
      { text: "safe retry" },
      {
        onProgress: ({ stage }) => {
          stages.push(stage);
        },
      },
    );
    assert.equal(replaced.platform_post_id, "published-2");
    assert.equal(createCount, 2);
    assert.equal(publishCount, 2);
    assert.deepEqual(stages, [
      "creating_container",
      "container_created",
      "container_ready",
      "publishing",
      "creating_container",
      "container_created",
      "container_ready",
      "publishing",
    ]);

    let timelineCount = 0;
    publishCount = 0;
    axios.get = (async (url: string) => {
      if (url.includes("/container-recovered")) {
        return { data: { status: "FINISHED" } };
      }
      timelineCount += 1;
      return {
        data: {
          data: [
            {
              id: "recovered-post",
              text: "accepted but response lost",
              timestamp: "2026-09-02T00:01:00.000Z",
              media_type: "TEXT_POST",
              permalink: "https://threads.net/recovered-post",
            },
          ],
        },
      };
    }) as typeof axios.get;
    axios.post = (async (url: string) => {
      if (url.endsWith("/threads_publish")) {
        publishCount += 1;
        throw axiosError(undefined);
      }
      return { data: { id: "container-recovered" } };
    }) as typeof axios.post;

    const recovered = await publishThreadsPost(
      account,
      { text: "accepted   but response lost" },
      { startedAt: "2026-09-02T00:00:00.000Z" },
    );
    assert.equal(recovered.platform_post_id, "recovered-post");
    assert.equal(publishCount, 1);
    assert.equal(timelineCount, 1);
    assert.equal(recovered.raw.reconciled_after_ambiguous_publish, true);

    let createForUnknown = 0;
    publishCount = 0;
    timelineCount = 0;
    axios.get = (async (url: string) => {
      if (url.includes("/container-unknown")) {
        return { data: { status: "FINISHED" } };
      }
      timelineCount += 1;
      return { data: { data: [] } };
    }) as typeof axios.get;
    axios.post = (async (url: string) => {
      if (url.endsWith("/threads_publish")) {
        publishCount += 1;
        throw axiosError(undefined);
      }
      createForUnknown += 1;
      return { data: { id: "container-unknown" } };
    }) as typeof axios.post;

    await assert.rejects(
      publishThreadsPost(
        account,
        { text: "unknown outcome" },
        { startedAt: "2026-09-02T00:00:00.000Z" },
      ),
      (error: unknown) =>
        error instanceof ThreadsPublishError &&
        error.details.kind === "ambiguous_publish",
    );
    assert.equal(createForUnknown, 1);
    assert.equal(publishCount, 1);
    assert.equal(timelineCount, 3);

    // A lost affiliate publish response must never trigger a second publish.
    // Recover only a reply owned by this account with the exact parent,
    // normalized body and original publication window.
    let recoveryPageReads = 0;
    axios.get = (async (_url: string, config?: { params?: { after?: string } }) => {
      if (_url.endsWith("/different-parent/replies")) {
        return { data: { data: [] } };
      }
      assert.ok(_url.endsWith("/me/replies"));
      recoveryPageReads += 1;
      if (!config?.params?.after) {
        return { data: {
          data: [{
            id: "wrong-parent", text: "PR same body",
            timestamp: "2026-09-02T00:02:00.000Z",
            replied_to: { id: "another-parent" },
          }],
          paging: { cursors: { after: "page-2" } },
        } };
      }
      return { data: { data: [
        {
          id: "old-reply", text: "PR same body",
          timestamp: "2026-09-01T22:00:00.000Z",
          replied_to: { id: "original-parent" },
        },
        {
          id: "actual-reply", text: "PR  same body",
          timestamp: "2026-09-02T00:01:00.000Z",
          permalink: "https://www.threads.net/@test_account/post/actual-reply",
          replied_to: { id: "original-parent" },
          is_reply_owned_by_me: true,
        },
      ] } };
    }) as typeof axios.get;
    const affiliateRecovered = await findThreadsReplyByContent(account, {
      text: "PR same body",
      replyToId: "original-parent",
      startedAt: "2026-09-02T00:00:00.000Z",
    });
    assert.equal(affiliateRecovered?.platform_post_id, "actual-reply");
    assert.equal(recoveryPageReads, 2);
    const noFalseMatch = await findThreadsReplyByContent(account, {
      text: "PR same body",
      replyToId: "different-parent",
      startedAt: "2026-09-02T00:00:00.000Z",
    });
    assert.equal(noFalseMatch, null);

    axios.get = (async (_url: string) => {
      if (_url.endsWith("/me/replies")) {
        return { data: { data: [] } };
      }
      assert.ok(_url.endsWith("/fallback-parent/replies"));
      return { data: { data: [
        {
          id: "someone-elses-reply", text: "PR fallback",
          username: "different_person",
          timestamp: "2026-09-02T00:02:00.000Z",
        },
        {
          id: "own-reply", text: "PR fallback",
          username: "test_account",
          replied_to: { id: "fallback-parent" },
          timestamp: "2026-09-02T00:01:00.000Z",
        },
      ] } };
    }) as typeof axios.get;
    const recoveredFromParent = await findThreadsReplyByContent(account, {
      text: "PR fallback", replyToId: "fallback-parent",
      startedAt: "2026-09-02T00:00:00.000Z",
    });
    assert.equal(recoveredFromParent?.platform_post_id, "own-reply");
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
  }

  console.log("Threads publish reliability tests passed (affiliate recovery included).\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
