const assert = require("node:assert/strict");

const {
  waitForThreadsContainerReady,
} = require("../src/services/threadsPublishService");

async function run(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function main() {
  await run("waitForThreadsContainerReady returns immediately when container is FINISHED", async () => {
    const requests = [];
    const result = await waitForThreadsContainerReady({
      accessToken: "secret-token",
      creationId: "container-1",
      requestApi: async (path, options) => {
        requests.push({ path, options });
        return { id: "container-1", status: "FINISHED" };
      },
      sleepFn: async () => {
        throw new Error("FINISHED container must not sleep");
      },
    });

    assert.deepEqual(result, { id: "container-1", status: "FINISHED" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, "container-1");
    assert.equal(requests[0].options.method, "GET");
    assert.equal(requests[0].options.accessToken, "secret-token");
    assert.deepEqual(requests[0].options.params, {
      fields: "id,status,error_message",
    });
    assert.ok(requests[0].options.signal instanceof AbortSignal);
  });

  await run("waitForThreadsContainerReady polls IN_PROGRESS until FINISHED", async () => {
    const statuses = ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"];
    const sleeps = [];
    let now = 0;

    const result = await waitForThreadsContainerReady({
      accessToken: "token",
      creationId: "container-2",
      pollIntervalMs: 5000,
      maxWaitMs: 60000,
      nowFn: () => now,
      sleepFn: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      requestApi: async () => ({
        id: "container-2",
        status: statuses.shift(),
      }),
    });

    assert.equal(result.status, "FINISHED");
    assert.deepEqual(sleeps, [5000, 5000]);
  });

  await run("waitForThreadsContainerReady surfaces Threads ERROR details immediately", async () => {
    let sleepCalls = 0;

    await assert.rejects(
      waitForThreadsContainerReady({
        accessToken: "token",
        creationId: "container-error",
        requestApi: async () => ({
          id: "container-error",
          status: "ERROR",
          error_message: "FAILED_DOWNLOADING_VIDEO",
        }),
        sleepFn: async () => {
          sleepCalls += 1;
        },
      }),
      (error) => {
        assert.equal(error.status, 502);
        assert.match(error.message, /FAILED_DOWNLOADING_VIDEO/);
        assert.equal(error.details.status, "ERROR");
        return true;
      }
    );

    assert.equal(sleepCalls, 0);
  });

  await run("waitForThreadsContainerReady rejects an EXPIRED container immediately", async () => {
    await assert.rejects(
      waitForThreadsContainerReady({
        accessToken: "token",
        creationId: "container-expired",
        requestApi: async () => ({
          id: "container-expired",
          status: "EXPIRED",
          error_message: "Container expired",
        }),
      }),
      { status: 502, message: "Threads container expired: Container expired" }
    );
  });

  await run("waitForThreadsContainerReady times out without exceeding maximum wait", async () => {
    const sleeps = [];
    let now = 0;
    let requestCount = 0;

    await assert.rejects(
      waitForThreadsContainerReady({
        accessToken: "token",
        creationId: "container-timeout",
        pollIntervalMs: 5000,
        maxWaitMs: 12000,
        nowFn: () => now,
        sleepFn: async (ms) => {
          sleeps.push(ms);
          now += ms;
        },
        requestApi: async () => {
          requestCount += 1;
          return { id: "container-timeout", status: "IN_PROGRESS" };
        },
      }),
      (error) => {
        assert.equal(error.status, 504);
        assert.match(error.message, /timed out after 12000 ms/);
        assert.equal(error.details.lastStatus, "IN_PROGRESS");
        return true;
      }
    );

    assert.deepEqual(sleeps, [5000, 5000, 2000]);
    assert.equal(requestCount, 3);
    assert.equal(now, 12000);
  });

  await run("waitForThreadsContainerReady aborts a status request at the deadline", async () => {
    await assert.rejects(
      waitForThreadsContainerReady({
        accessToken: "token",
        creationId: "container-hanging",
        pollIntervalMs: 5,
        maxWaitMs: 20,
        requestApi: async (path, options) =>
          new Promise((resolve, reject) => {
            options.signal.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      }),
      (error) => {
        assert.equal(error.status, 504);
        assert.match(error.message, /timed out after 20 ms/);
        return true;
      }
    );
  });
}

main();
