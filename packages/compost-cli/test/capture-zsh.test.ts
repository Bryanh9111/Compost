import { describe, expect, test } from "bun:test";
import {
  buildGitCaptureEvent,
  buildObsidianCaptureEvent,
  buildZshCaptureEvent,
} from "../src/commands/capture";

describe("capture zsh", () => {
  test("builds a zsh outbox event with redacted command content", () => {
    const built = buildZshCaptureEvent({
      command: "export API_TOKEN=supersecret && bun test",
      cwd: "/Users/zion/Repos/Zylo/Compost",
      exitStatus: 0,
      startedAt: "2026-05-03T02:00:00.000Z",
      endedAt: "2026-05-03T02:00:02.000Z",
      shellPid: "4242",
      user: "zion",
      host: "mac",
    });

    expect(built).toBeTruthy();
    expect(built!.event.adapter).toBe("compost-adapter-zsh");
    expect(built!.event.source_kind).toBe("host-adapter");
    expect(built!.event.transform_policy).toBe("tp-2026-04");
    expect(built!.redactions).toBeGreaterThanOrEqual(1);

    const payload = JSON.parse(built!.event.payload) as { content: string };
    const content = JSON.parse(payload.content) as {
      command: string;
      cwd: string;
      exit_status: number;
    };

    expect(content.command).toContain("API_TOKEN=[REDACTED]");
    expect(content.command).not.toContain("supersecret");
    expect(content.cwd).toBe("/Users/zion/Repos/Zylo/Compost");
    expect(content.exit_status).toBe(0);
  });

  test("skips empty and recursive capture commands", () => {
    expect(buildZshCaptureEvent({ command: "   " })).toBeNull();
    expect(buildZshCaptureEvent({ command: "compost capture zsh" })).toBeNull();
    expect(
      buildZshCaptureEvent({
        command: "bun packages/compost-cli/src/main.ts capture zsh",
      })
    ).toBeNull();
  });
});

describe("capture git", () => {
  test("builds a git outbox event with commit metadata", () => {
    const built = buildGitCaptureEvent({
      repoRoot: "/Users/zion/Repos/Zylo/Compost",
      commitSha: "6ba90c1a2b3c4d5e6f",
      subject: "feat: capture git TOKEN=secret",
      branch: "main",
      authorName: "Henghao Zhou",
      committedAt: "2026-05-03T03:00:00.000Z",
      capturedAt: "2026-05-03T03:00:01.000Z",
    });

    expect(built).toBeTruthy();
    expect(built!.event.adapter).toBe("compost-adapter-git");
    expect(built!.event.source_kind).toBe("host-adapter");
    expect(built!.event.source_uri).toContain("@6ba90c1a2b3c4d5e6f");
    expect(built!.event.transform_policy).toBe("tp-2026-04");

    const payload = JSON.parse(built!.event.payload) as { content: string };
    const content = JSON.parse(payload.content) as {
      kind: string;
      commit_sha: string;
      short_sha: string;
      repo_name: string;
      subject: string;
      branch: string;
    };

    expect(content.kind).toBe("git-commit");
    expect(content.commit_sha).toBe("6ba90c1a2b3c4d5e6f");
    expect(content.short_sha).toBe("6ba90c1a2b3c");
    expect(content.repo_name).toBe("Compost");
    expect(content.subject).toContain("TOKEN=[REDACTED]");
    expect(content.subject).not.toContain("secret");
    expect(content.branch).toBe("main");
  });

  test("skips missing repo and invalid commit SHA", () => {
    expect(
      buildGitCaptureEvent({
        repoRoot: "",
        commitSha: "6ba90c1",
      })
    ).toBeNull();
    expect(
      buildGitCaptureEvent({
        repoRoot: "/Users/zion/Repos/Zylo/Compost",
        commitSha: "not-a-sha",
      })
    ).toBeNull();
  });
});

describe("capture obsidian", () => {
  test("builds an Obsidian note-change outbox event", () => {
    const built = buildObsidianCaptureEvent({
      vaultRoot: "/Users/example/Vaults/Constellation",
      filePath: "/Users/example/Vaults/Constellation/XHS Knowledge/XHS Knowledge.md",
      event: "updated",
      modifiedAt: "2026-05-03T04:00:00.000Z",
      capturedAt: "2026-05-03T04:00:01.000Z",
      sizeBytes: 2048,
    });

    expect(built).toBeTruthy();
    expect(built!.event.adapter).toBe("compost-adapter-obsidian");
    expect(built!.event.source_kind).toBe("host-adapter");
    expect(built!.event.source_uri).toBe(
      "obsidian://Constellation/XHS Knowledge/XHS Knowledge.md"
    );
    expect(built!.event.transform_policy).toBe("tp-2026-04");

    const payload = JSON.parse(built!.event.payload) as { content: string };
    const content = JSON.parse(payload.content) as {
      kind: string;
      vault_name: string;
      relative_path: string;
      event: string;
      size_bytes: number;
    };

    expect(content.kind).toBe("obsidian-note-change");
    expect(content.vault_name).toBe("Constellation");
    expect(content.relative_path).toBe("XHS Knowledge/XHS Knowledge.md");
    expect(content.event).toBe("updated");
    expect(content.size_bytes).toBe(2048);
  });

  test("skips non-markdown and .obsidian paths", () => {
    expect(
      buildObsidianCaptureEvent({
        vaultRoot: "/Users/example/Vaults/Constellation",
        filePath: "/Users/example/Vaults/Constellation/image.png",
      })
    ).toBeNull();
    expect(
      buildObsidianCaptureEvent({
        vaultRoot: "/Users/example/Vaults/Constellation",
        filePath: "/Users/example/Vaults/Constellation/.obsidian/workspace.json",
      })
    ).toBeNull();
  });

  test("keeps idempotency stable for the same note change", () => {
    const first = buildObsidianCaptureEvent({
      vaultRoot: "/Users/example/Vaults/Constellation",
      filePath: "/Users/example/Vaults/Constellation/XHS Knowledge/XHS Knowledge.md",
      event: "updated",
      modifiedAt: "2026-05-03T04:00:00.000Z",
      capturedAt: "2026-05-03T04:00:01.000Z",
      sizeBytes: 2048,
    });
    const second = buildObsidianCaptureEvent({
      vaultRoot: "/Users/example/Vaults/Constellation",
      filePath: "/Users/example/Vaults/Constellation/XHS Knowledge/XHS Knowledge.md",
      event: "updated",
      modifiedAt: "2026-05-03T04:00:00.000Z",
      capturedAt: "2026-05-03T04:00:05.000Z",
      sizeBytes: 2048,
    });

    expect(first?.event.idempotency_key).toBe(second?.event.idempotency_key);
  });
});
