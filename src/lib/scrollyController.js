import { writable } from "svelte/store";

export const scrollyCommand = writable(null);

export function sendScrollyCommand(cmd) {
  scrollyCommand.set({ ...cmd, _ts: Date.now() });
}
