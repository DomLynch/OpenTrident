import { generateKeyPairSync, sign as nodeSign, createPrivateKey, createPublicKey, verify as nodeVerify } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const KEY_FILE = "signing-key-v1.pem";
const PUB_FILE = "signing-pubkey-v1.pem";

export async function ensureSigningKey(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  const dir = resolveStateDir();
  const keyPath = path.join(dir, KEY_FILE);
  const pubPath = path.join(dir, PUB_FILE);
  try {
    const privateKeyPem = await fs.readFile(keyPath, "utf8");
    const publicKeyPem = await fs.readFile(pubPath, "utf8");
    return { privateKeyPem, publicKeyPem };
  } catch {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(keyPath, privateKeyPem, { mode: 0o600 });
    await fs.writeFile(pubPath, publicKeyPem, "utf8");
    return { privateKeyPem, publicKeyPem };
  }
}

export function signBytes(privateKeyPem: string, data: Buffer): string {
  const key = createPrivateKey(privateKeyPem);
  return nodeSign(null, data, key).toString("base64");
}

export function verifyBytes(publicKeyPem: string, data: Buffer, signature: string): boolean {
  const key = createPublicKey(publicKeyPem);
  return nodeVerify(null, data, key, Buffer.from(signature, "base64"));
}
