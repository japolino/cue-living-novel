import { describe, expect, test } from "bun:test";
import { PackSound } from "./pack-sound.js";

function fakeEngine() {
  const calls: string[] = [];
  return {
    calls,
    engine: {
      playBgm: (src: string) => { calls.push(`bgm:${src}`); },
      playSfx: (src: string) => { calls.push(`sfx:${src}`); },
      stopAll: () => { calls.push("stop"); },
    },
  };
}

describe("PackSound", () => {
  test("while Choir plays the sound the pack is quiet, but its music is tracked and resumes on the way back", () => {
    const { calls, engine } = fakeEngine();
    const pack = new PackSound(engine);
    pack.play({ bgm: "calm.mp3" });
    pack.useChoir(true, true);
    pack.play({ bgm: "tense.mp3", sfx: "door.mp3" });
    pack.restore("calm.mp3");
    pack.play({ bgm: "tense.mp3" });
    expect(calls).toEqual(["bgm:calm.mp3", "stop", "stop"]);

    pack.useChoir(false, true);
    expect(calls.at(-1)).toBe("bgm:tense.mp3");
  });

  test("switching back with the view closed does not start music", () => {
    const { calls, engine } = fakeEngine();
    const pack = new PackSound(engine);
    pack.useChoir(true, false);
    pack.play({ bgm: "calm.mp3" });
    pack.useChoir(false, false);
    expect(calls).toEqual(["stop"]);
  });

  test("another chat stops the music and never resumes it later", () => {
    const { calls, engine } = fakeEngine();
    const pack = new PackSound(engine);
    pack.play({ bgm: "chat-a.mp3" });
    pack.reset();
    pack.useChoir(true, true);
    pack.useChoir(false, true);
    expect(calls).toEqual(["bgm:chat-a.mp3", "stop", "stop"]);
    expect(pack.currentMusic).toBeNull();
  });
});
