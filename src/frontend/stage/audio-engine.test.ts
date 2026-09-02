import { describe, expect, test, beforeEach } from "bun:test";
import { AudioEngine, createMockAudioPlayer, type AudioPlayerElement } from "./audio-engine.js";

describe("AudioEngine", () => {
  let createdPlayers: AudioPlayerElement[];
  let playerFactory: (src: string) => AudioPlayerElement;

  beforeEach(() => {
    createdPlayers = [];
    playerFactory = (src: string) => {
      const p = createMockAudioPlayer(src);
      createdPlayers.push(p);
      return p;
    };
  });

  test("initializes with default or custom volumes and clamps values", () => {
    const engine = new AudioEngine({ audioFactory: playerFactory });
    expect(engine.getBgmVolume()).toBe(0.7);
    expect(engine.getSfxVolume()).toBe(0.8);

    engine.setBgmVolume(0.4);
    expect(engine.getBgmVolume()).toBe(0.4);

    engine.setBgmVolume(-1);
    expect(engine.getBgmVolume()).toBe(0);

    engine.setBgmVolume(5);
    expect(engine.getBgmVolume()).toBe(1);

    engine.setSfxVolume(0.2);
    expect(engine.getSfxVolume()).toBe(0.2);
  });

  test("playBgm initializes track, loops it, and fades in volume", async () => {
    const engine = new AudioEngine({
      bgmVolume: 0.8,
      crossfadeDuration: 50, // Short duration for test speed
      audioFactory: playerFactory,
    });

    engine.playBgm("bgm_peaceful.mp3");

    expect(createdPlayers.length).toBe(1);
    const p = createdPlayers[0]!;
    expect(p.src).toBe("bgm_peaceful.mp3");
    expect(p.loop).toBe(true);
    expect(p.paused).toBe(false);

    // Initial volume is 0
    expect(p.volume).toBe(0);

    // Wait for fade in
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(p.volume).toBeCloseTo(0.8, 1);
  });

  test("playBgm crossfades between tracks over the duration", async () => {
    const engine = new AudioEngine({
      bgmVolume: 0.6,
      crossfadeDuration: 60,
      audioFactory: playerFactory,
    });

    engine.playBgm("track_a.mp3");
    const playerA = createdPlayers[0]!;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(playerA.volume).toBeCloseTo(0.6, 1);

    // Crossfade to track B
    engine.playBgm("track_b.mp3");
    expect(createdPlayers.length).toBe(2);
    const playerB = createdPlayers[1]!;

    expect(playerB.src).toBe("track_b.mp3");
    expect(playerB.loop).toBe(true);
    expect(playerB.volume).toBe(0);

    // Wait for crossfade to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Track A should be paused and faded out
    expect(playerA.volume).toBe(0);
    expect(playerA.paused).toBe(true);

    // Track B should be at target volume
    expect(playerB.volume).toBeCloseTo(0.6, 1);
    expect(playerB.paused).toBe(false);
  });

  test("playBgm with identical track preserves playback without restart", () => {
    const engine = new AudioEngine({
      bgmVolume: 0.5,
      audioFactory: playerFactory,
    });

    engine.playBgm("same_track.mp3");
    expect(createdPlayers.length).toBe(1);

    engine.playBgm("same_track.mp3");
    expect(createdPlayers.length).toBe(1); // No new player created
  });

  test("stopBgm smoothly fades out and pauses track", async () => {
    const engine = new AudioEngine({
      bgmVolume: 0.7,
      crossfadeDuration: 50,
      audioFactory: playerFactory,
    });

    engine.playBgm("theme.mp3");
    const p = createdPlayers[0]!;
    await new Promise((resolve) => setTimeout(resolve, 70));

    engine.stopBgm({ fadeDuration: 50 });
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(p.volume).toBe(0);
    expect(p.paused).toBe(true);
    expect(engine.getCurrentBgm()).toBeNull();
  });

  test("playSfx plays one-shot audio with loop=false and scaled volume", () => {
    const engine = new AudioEngine({
      sfxVolume: 0.5,
      audioFactory: playerFactory,
    });

    engine.playSfx("slash.wav");
    expect(createdPlayers.length).toBe(1);
    const p = createdPlayers[0]!;
    expect(p.src).toBe("slash.wav");
    expect(p.loop).toBe(false);
    expect(p.volume).toBe(0.5);
    expect(p.paused).toBe(false);

    engine.playSfx("explosion.wav", { volume: 0.5 });
    const p2 = createdPlayers[1]!;
    expect(p2.volume).toBe(0.25);
  });

  test("stopAll halts all BGM and SFX immediately", () => {
    const engine = new AudioEngine({
      audioFactory: playerFactory,
    });

    engine.playBgm("bgm.mp3");
    engine.playSfx("sfx.wav");

    const bgm = createdPlayers[0]!;
    const sfx = createdPlayers[1]!;

    engine.stopAll();

    expect(bgm.paused).toBe(true);
    expect(sfx.paused).toBe(true);
    expect(engine.getCurrentBgm()).toBeNull();
  });
});
