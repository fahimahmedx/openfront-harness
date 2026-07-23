import { createHmac, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

interface LimitState {
  utcDay: string;
  total: number;
  ipHashes: string[];
}

export type LimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; reason: "ip" | "daily"; remaining: number };

export class DailyRateLimiter {
  private state: LimitState = { utcDay: "", total: 0, ipHashes: [] };

  constructor(
    private readonly file: string,
    private readonly salt: string,
    private readonly dailyLimit = 5,
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      this.state = JSON.parse(
        await fs.readFile(this.file, "utf8"),
      ) as LimitState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("Resetting unreadable rate-limit state", error);
      }
    }
    this.rollDay();
  }

  status() {
    this.rollDay();
    return {
      utcDay: this.state.utcDay,
      used: this.state.total,
      limit: this.dailyLimit,
      remaining: Math.max(0, this.dailyLimit - this.state.total),
    };
  }

  async consume(ip: string): Promise<LimitResult> {
    this.rollDay();
    const hash = createHmac("sha256", this.salt).update(ip).digest("hex");
    if (this.state.ipHashes.includes(hash)) {
      return {
        allowed: false,
        reason: "ip",
        remaining: Math.max(0, this.dailyLimit - this.state.total),
      };
    }
    if (this.state.total >= this.dailyLimit) {
      return { allowed: false, reason: "daily", remaining: 0 };
    }
    this.state.total++;
    this.state.ipHashes.push(hash);
    await this.save();
    return {
      allowed: true,
      remaining: Math.max(0, this.dailyLimit - this.state.total),
    };
  }

  private rollDay(): void {
    const utcDay = new Date().toISOString().slice(0, 10);
    if (this.state.utcDay !== utcDay) {
      this.state = { utcDay, total: 0, ipHashes: [] };
    }
  }

  private async save(): Promise<void> {
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.state, null, 2));
    await fs.rename(temp, this.file);
  }
}
