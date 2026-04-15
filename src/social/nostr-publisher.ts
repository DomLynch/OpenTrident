import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from "nostr-tools/pure";
import { Relay } from "nostr-tools/relay";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const NOSTR_KEY_FILE = "nostr-sk-v1.bin";
const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

async function ensureNostrKey(): Promise<Uint8Array> {
  const keyPath = path.join(resolveStateDir(), NOSTR_KEY_FILE);
  try {
    const raw = await fs.readFile(keyPath);
    return new Uint8Array(raw);
  } catch {
    const sk = generateSecretKey();
    await fs.writeFile(keyPath, Buffer.from(sk), { mode: 0o600 });
    return sk;
  }
}

export async function getNostrPubkey(): Promise<{ hex: string; npub: string }> {
  const sk = await ensureNostrKey();
  const hex = getPublicKey(sk);
  return { hex, npub: nip19.npubEncode(hex) };
}

export async function publishToNostr(params: {
  text: string;
  tags?: string[][];
  relays?: string[];
}): Promise<{ ok: boolean; eventId?: string; errors: string[] }> {
  const sk = await ensureNostrKey();
  const relayUrls = params.relays ?? DEFAULT_RELAYS;

  const event = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: params.tags ?? [],
      content: params.text,
    },
    sk,
  );

  const errors: string[] = [];
  let anySuccess = false;

  await Promise.all(
    relayUrls.map(async (url) => {
      try {
        const relay = await Relay.connect(url);
        await relay.publish(event);
        await relay.close();
        anySuccess = true;
      } catch (err) {
        errors.push(`${url}: ${String(err).slice(0, 100)}`);
      }
    }),
  );

  return { ok: anySuccess, eventId: event.id, errors };
}
