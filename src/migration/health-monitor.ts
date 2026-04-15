import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { resolveStateDir } from "../config/paths.js";

const execAsync = promisify(exec);

export type HealthCheckResult = {
  timestamp: number;
  checks: {
    gateway: { ok: boolean; latencyMs?: number; error?: string };
    disk: { ok: boolean; freeGb?: number; totalGb?: number; error?: string };
    memory: { ok: boolean; usedMb?: number; totalMb?: number; error?: string };
    telegramBot: { ok: boolean; error?: string };
    modelApi: { ok: boolean; provider?: string; error?: string };
    sslExpiry: { ok: boolean; daysRemaining?: number; error?: string };
  };
  overallHealthy: boolean;
  migrationTriggered: boolean;
  migrationReason?: string;
};

async function httpGet(url: string, timeoutMs = 5000): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: String(err) };
  }
}

export async function checkGatewayHealth(): Promise<HealthCheckResult["checks"]["gateway"]> {
  const stateDir = resolveStateDir();
  const port = process.env.OPENCLAW_GATEWAY_PORT ?? "18789";
  const result = await httpGet(`http://localhost:${port}/healthz`);
  return result;
}

export async function checkDiskSpace(): Promise<HealthCheckResult["checks"]["disk"]> {
  try {
    const { stdout } = await execAsync("df -k / | awk 'NR==2 {print $2\",\"$3\",\"$4}'");
    const [totalKb, usedKb, freeKb] = stdout.trim().split(",").map(Number);
    const freeGb = freeKb / 1024 / 1024;
    const totalGb = totalKb / 1024 / 1024;
    return { ok: freeGb >= 10, freeGb: Math.round(freeGb * 10) / 10, totalGb: Math.round(totalGb * 10) / 10 };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function checkMemoryUsage(): Promise<HealthCheckResult["checks"]["memory"]> {
  try {
    const { stdout } = await execAsync("free -m");
    const lines = stdout.trim().split("\n");
    const memLine = lines.find((l) => l.startsWith("Mem:"));
    if (!memLine) return { ok: false, error: "Could not parse memory info" };
    const parts = memLine.split(/\s+/);
    const totalMb = Number(parts[1]);
    const usedMb = Number(parts[2]);
    return { ok: usedMb / totalMb < 0.95, usedMb, totalMb };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function checkTelegramBot(): Promise<HealthCheckResult["checks"]["telegramBot"]> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await resp.json() as { ok: boolean; result?: { username?: string } };
    return { ok: data.ok, error: data.ok ? undefined : "Bot API error" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function checkModelApi(): Promise<HealthCheckResult["checks"]["modelApi"]> {
  const minimaxKey = process.env.MINIMAX_API_KEY;
  const zaiKey = process.env.ZAI_API_KEY;
  const apiKey = minimaxKey || zaiKey;
  if (!apiKey) return { ok: false, error: "No AI API key configured" };
  const provider = minimaxKey ? "minimax" : "zai";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch("https://api.minimax.chat/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await resp.json() as { data?: unknown[] };
    return { ok: resp.ok, provider };
  } catch (err) {
    return { ok: false, provider, error: String(err) };
  }
}

export async function checkSslExpiry(hostname: string = "api.telegram.org"): Promise<HealthCheckResult["checks"]["sslExpiry"]> {
  return new Promise((resolve) => {
    const req = https.get(
      { hostname, port: 443, method: "GET", timeout: 5000 },
      (res) => {
        const cert = res.socket.getPeerCertificate();
        if (!cert || !cert.valid_to) {
          resolve({ ok: false, error: "No certificate found" });
          return;
        }
        const expiryDate = new Date(cert.valid_to);
        const daysRemaining = Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        resolve({ ok: daysRemaining > 7, daysRemaining, hostname });
        res.destroy();
      },
    );
    req.on("error", (err) => resolve({ ok: false, error: String(err), hostname }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "Connection timeout", hostname });
    });
  });
}

export async function runHealthChecks(): Promise<HealthCheckResult> {
  const [gateway, disk, memory, telegram, modelApi, ssl] = await Promise.all([
    checkGatewayHealth(),
    checkDiskSpace(),
    checkMemoryUsage(),
    checkTelegramBot(),
    checkModelApi(),
    checkSslExpiry(),
  ]);

  const checks = { gateway, disk, memory, telegramBot: telegram, modelApi, sslExpiry: ssl };
  const overallHealthy = gateway.ok && disk.ok && memory.ok && telegram.ok && modelApi.ok && ssl.ok;

  let migrationTriggered = false;
  let migrationReason: string | undefined;

  if (!disk.ok) {
    migrationTriggered = true;
    migrationReason = `Disk space critical: ${disk.freeGb}GB free (threshold: 10GB)`;
  } else if (!gateway.ok) {
    migrationTriggered = true;
    migrationReason = "Gateway health check failed";
  }

  return {
    timestamp: Date.now(),
    checks,
    overallHealthy,
    migrationTriggered,
    migrationReason,
  };
}

export async function saveHealthResult(result: HealthCheckResult): Promise<void> {
  const stateDir = resolveStateDir();
  const filePath = path.join(stateDir, "health-check-v1.json");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(result, null, 2), "utf8");
}

export async function healthCheckCommand(): Promise<void> {
  const result = await runHealthChecks();
  await saveHealthResult(result);
  console.log(JSON.stringify(result, null, 2));
}