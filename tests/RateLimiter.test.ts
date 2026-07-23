import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, test } from "vitest";
import { DailyRateLimiter } from "../src/RateLimiter";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true })),
  );
});

describe("DailyRateLimiter", () => {
  test("stores only HMAC identifiers and enforces both limits", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openfront-limit-"));
    dirs.push(dir);
    const file = path.join(dir, "limits.json");
    const limiter = new DailyRateLimiter(file, "test-secret", 2);
    await limiter.init();
    expect((await limiter.consume("203.0.113.1")).allowed).toBe(true);
    expect(await limiter.consume("203.0.113.1")).toMatchObject({
      allowed: false,
      reason: "ip",
    });
    expect((await limiter.consume("203.0.113.2")).allowed).toBe(true);
    expect(await limiter.consume("203.0.113.3")).toMatchObject({
      allowed: false,
      reason: "daily",
    });
    expect(await fs.readFile(file, "utf8")).not.toContain("203.0.113");
  });
});
