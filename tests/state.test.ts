import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { StateStore } from "../src/state.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryStatePath() {
  const directory = await mkdtemp(join(tmpdir(), "thee-discord-state-"));
  directories.push(directory);
  return join(directory, "state.json");
}

describe("StateStore", () => {
  it("round-trips validated guild state with an atomic replacement", async () => {
    const path = await temporaryStatePath();
    const store = new StateStore(path);
    store.guild("123456789012345678").channels.general = "234567890123456789";
    await store.save();

    const loaded = new StateStore(path);
    await loaded.load();
    expect(loaded.guild("123456789012345678").channels.general).toBe("234567890123456789");
    expect(JSON.parse(await readFile(path, "utf8")).version).toBe(1);
  });

  it("rejects malformed resource IDs and prototype-like keys", async () => {
    const path = await temporaryStatePath();
    await writeFile(path, '{"version":1,"guilds":{"123456789012345678":{"roles":{"__proto__":"bad"},"channels":{},"messages":{}}}}');
    await expect(new StateStore(path).load()).rejects.toThrow(/Invalid role state entry/);
  });

  it.runIf(process.platform !== "win32")("refuses a symbolic-link state file", async () => {
    const path = await temporaryStatePath();
    const target = `${path}.target`;
    await writeFile(target, JSON.stringify({ version: 1, guilds: {} }));
    await symlink(target, path, "file");
    await expect(new StateStore(path).load()).rejects.toThrow(/symbolic link/);
  });

  it("refuses a symbolic-link or junction parent during save", async () => {
    const root = await mkdtemp(join(tmpdir(), "thee-discord-root-"));
    const outside = await mkdtemp(join(tmpdir(), "thee-discord-outside-"));
    directories.push(root, outside);
    const linkedParent = join(root, "linked");
    await mkdir(join(outside, "state"));
    await symlink(join(outside, "state"), linkedParent, process.platform === "win32" ? "junction" : "dir");

    const store = new StateStore(join(linkedParent, "state.json"), root);
    store.guild("123456789012345678").channels.general = "234567890123456789";
    await expect(store.save()).rejects.toThrow(/symbolic-link or junction parent/);
  });

  it("rejects a state parent outside the configured root", async () => {
    const root = await mkdtemp(join(tmpdir(), "thee-discord-root-"));
    const outside = await mkdtemp(join(tmpdir(), "thee-discord-outside-"));
    directories.push(root, outside);
    const store = new StateStore(join(outside, "state.json"), root);
    await expect(store.save()).rejects.toThrow(/inside the configured package root/);
  });
});
