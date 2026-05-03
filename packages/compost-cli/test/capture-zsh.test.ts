import { describe, expect, test } from "bun:test";
import { buildZshCaptureEvent } from "../src/commands/capture";

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
