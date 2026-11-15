import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const LENGTH = 10;
// Largest multiple of 62 below 256; bytes at or above it are rejected so
// every character is uniformly likely.
const LIMIT = 256 - (256 % ALPHABET.length);

export function newId(): string {
  let id = "";
  while (id.length < LENGTH) {
    for (const byte of randomBytes(LENGTH * 2)) {
      if (byte < LIMIT && id.length < LENGTH) id += ALPHABET[byte % ALPHABET.length];
    }
  }
  return id;
}
