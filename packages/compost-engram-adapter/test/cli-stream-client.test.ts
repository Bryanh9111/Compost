import { describe, test, expect } from "bun:test";
import {
  CliEngramStreamClient,
  parseJsonlEntries,
  type SpawnFn,
} from "../src/cli-stream-client";

function mockSpawn(opts: {
  stdout: string;
  stderr?: string;
  exitCode?: number;
  capture?: (cmd: string[]) => void;
}): SpawnFn {
  return (args) => {
    opts.capture?.(args.cmd);
    const stdoutBytes = new TextEncoder().encode(opts.stdout);
    const stderrBytes = new TextEncoder().encode(opts.stderr ?? "");
    return {
      exited: Promise.resolve(opts.exitCode ?? 0),
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(stdoutBytes);
          controller.close();
        },
      }),
      stderr: new ReadableStream({
        start(controller) {
          controller.enqueue(stderrBytes);
          controller.close();
        },
      }),
    };
  };
}

function validEntry(memoryId: string, updatedAt: string): string {
  return JSON.stringify({
    memory_id: memoryId,
    kind: "event",
    content: "c",
    project: "compost",
    scope: "project",
    created_at: updatedAt,
    updated_at: updatedAt,
    tags: [],
    origin: "human",
  });
}

describe("parseJsonlEntries", () => {
  test("returns empty array for empty stdout", () => {
    const r = parseJsonlEntries("");
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([]);
  });

  test("skips blank lines", () => {
    const r = parseJsonlEntries(
      `\n${validEntry("a", "2026-04-17T00:00:00Z")}\n\n${validEntry("b", "2026-04-17T01:00:00Z")}\n`
    );
    expect(r.ok).toBe(true);
    expect(r.data?.map((e) => e.memory_id)).toEqual(["a", "b"]);
  });

  test("error on malformed JSON line reports line number", () => {
    const r = parseJsonlEntries(
      `${validEntry("a", "2026-04-17T00:00:00Z")}\n{not json\n`
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("line 2");
  });

  test("error on zod rejection reports memory_id when available", () => {
    const badEntry = JSON.stringify({
      memory_id: "m-bad",
      kind: "event",
      content: "c",
      project: null,
      scope: "session", // invalid scope
      created_at: "2026-04-17T00:00:00Z",
      updated_at: "2026-04-17T00:00:00Z",
      tags: [],
      origin: "human",
    });
    const r = parseJsonlEntries(badEntry);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("m-bad");
  });

  test("error on zod rejection without memory_id uses '(unknown)'", () => {
    const r = parseJsonlEntries(`{"kind":"event"}`);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("(unknown)");
  });
});

describe("CliEngramStreamClient command construction", () => {
  test("no args → base cmd only", async () => {
    let captured: string[] = [];
    const client = new CliEngramStreamClient({
      spawn: mockSpawn({ stdout: "", capture: (c) => (captured = c) }),
    });
    await client.streamForCompost({});
    expect(captured).toEqual(["engram", "export-stream"]);
  });

  test("since + limit passed through", async () => {
    let captured: string[] = [];
    const client = new CliEngramStreamClient({
      spawn: mockSpawn({ stdout: "", capture: (c) => (captured = c) }),
    });
    await client.streamForCompost({
      since: "2026-04-17T00:00:00Z",
      limit: 500,
    });
    expect(captured).toContain("--since");
    expect(captured).toContain("2026-04-17T00:00:00Z");
    expect(captured).toContain("--limit");
    expect(captured).toContain("500");
  });

  test("kinds emitted as repeated --kinds flags", async () => {
    let captured: string[] = [];
    const client = new CliEngramStreamClient({
      spawn: mockSpawn({ stdout: "", capture: (c) => (captured = c) }),
    });
    await client.streamForCompost({ kinds: ["event", "preference"] });
    expect(
      captured.filter((s) => s === "--kinds" || s === "event" || s === "preference")
    ).toEqual(["--kinds", "event", "--kinds", "preference"]);
  });

  test("project passed through", async () => {
    let captured: string[] = [];
    const client = new CliEngramStreamClient({
      spawn: mockSpawn({ stdout: "", capture: (c) => (captured = c) }),
    });
    await client.streamForCompost({ project: "compost" });
    expect(captured).toContain("--project");
    expect(captured).toContain("compost");
  });

  test("include_compost flag only when true", async () => {
    let capturedDefault: string[] = [];
    let capturedExplicit: string[] = [];
    await new CliEngramStreamClient({
      spawn: mockSpawn({
        stdout: "",
        capture: (c) => (capturedDefault = c),
      }),
    }).streamForCompost({});
    await new CliEngramStreamClient({
      spawn: mockSpawn({
        stdout: "",
        capture: (c) => (capturedExplicit = c),
      }),
    }).streamForCompost({ include_compost: true });

    expect(capturedDefault.includes("--include-compost")).toBe(false);
    expect(capturedExplicit.includes("--include-compost")).toBe(true);
  });

  test("engramBin override used in command", async () => {
    let captured: string[] = [];
    const client = new CliEngramStreamClient({
      engramBin: "/opt/custom/engram",
      spawn: mockSpawn({ stdout: "", capture: (c) => (captured = c) }),
    });
    await client.streamForCompost({});
    expect(captured[0]).toBe("/opt/custom/engram");
  });
});

describe("CliEngramStreamClient result", () => {
  test("ok result with 2 entries parsed", async () => {
    const entries = [
      validEntry("a", "2026-04-17T00:00:00Z"),
      validEntry("b", "2026-04-17T01:00:00Z"),
    ].join("\n");
    const client = new CliEngramStreamClient({
      spawn: mockSpawn({ stdout: entries }),
    });
    const r = await client.streamForCompost({});
    expect(r.ok).toBe(true);
    expect(r.data?.map((e) => e.memory_id)).toEqual(["a", "b"]);
  });

  test("non-zero exit code returns MCPCallResult error with stderr preview", async () => {
    const client = new CliEngramStreamClient({
      spawn: mockSpawn({
        stdout: "",
        stderr: "database not found",
        exitCode: 1,
      }),
    });
    const r = await client.streamForCompost({});
    expect(r.ok).toBe(false);
    expect(r.error).toContain("exited 1");
    expect(r.error).toContain("database not found");
  });

  test("spawn throwing returns error without propagating", async () => {
    const client = new CliEngramStreamClient({
      spawn: (() => {
        throw new Error("ENOENT: engram");
      }) as unknown as SpawnFn,
    });
    const r = await client.streamForCompost({});
    expect(r.ok).toBe(false);
    expect(r.error).toContain("ENOENT");
  });
});
