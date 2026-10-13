import type { AudioEngine } from "../stage/audio-engine.js";

/**
 * Cue's own pack audio for the open view. While Choir provides the sound the
 * pack stays quiet, but the music in effect is still tracked so switching
 * back resumes the right track.
 */
export class PackSound {
  private music: string | null = null;
  private choir = false;

  constructor(private readonly engine: Pick<AudioEngine, "playBgm" | "playSfx" | "stopAll">) {}

  get currentMusic(): string | null {
    return this.music;
  }

  /** To Choir silences the pack; back to the pack resumes its music when `resume`. */
  useChoir(on: boolean, resume: boolean): void {
    if (on === this.choir) return;
    this.choir = on;
    if (on) this.engine.stopAll();
    else if (resume && this.music) this.engine.playBgm(this.music);
  }

  play(cue: { bgm?: string | null | undefined; sfx?: string | null | undefined }): void {
    if (cue.bgm) this.music = cue.bgm;
    if (this.choir) return;
    if (cue.bgm) this.engine.playBgm(cue.bgm);
    if (cue.sfx) this.engine.playSfx(cue.sfx);
  }

  /** Going back: the music in effect at that paragraph replaces whatever plays. */
  restore(music: string | null): void {
    this.engine.stopAll();
    this.music = music;
    if (music && !this.choir) this.engine.playBgm(music);
  }

  /** Another chat: nothing from this one keeps playing or resumes later. */
  reset(): void {
    this.music = null;
    this.engine.stopAll();
  }
}
