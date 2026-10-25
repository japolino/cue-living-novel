import { describe, expect, test } from "bun:test";
import { INNER_VOICE_COLORS, SPEAKER_COLORS, bareSpeakerName, innerVoiceFor, speakerColor } from "./voices";

describe("inner voices", () => {
  test("skill names in English and Korean are inner voices, coloured by family", () => {
    expect(innerVoiceFor("Perception")?.color).toBe(INNER_VOICE_COLORS.motorics);
    expect(innerVoiceFor("지각")?.color).toBe(INNER_VOICE_COLORS.motorics);
    expect(innerVoiceFor("평정")?.family).toBe("motorics");
    expect(innerVoiceFor("논리")?.color).toBe(INNER_VOICE_COLORS.intellect);
    expect(innerVoiceFor("INLAND EMPIRE")?.family).toBe("psyche");
    expect(innerVoiceFor("Half Light")?.family).toBe("physique");
  });

  test("brackets and check results around the name are ignored", () => {
    expect(bareSpeakerName("PERCEPTION [Medium: Success]")).toBe("perception");
    expect(innerVoiceFor("[Logic]")?.family).toBe("intellect");
    expect(innerVoiceFor("Composure (Easy)")?.family).toBe("motorics");
    expect(innerVoiceFor("Shivers - Success")?.family).toBe("physique");
  });

  test("ordinary speakers are not inner voices; the reader's own names are", () => {
    expect(innerVoiceFor("Cecilia Holmes")).toBeNull();
    expect(innerVoiceFor("")).toBeNull();
    expect(innerVoiceFor(undefined)).toBeNull();
    expect(innerVoiceFor("Conscience")).toBeNull();
    expect(innerVoiceFor("conscience", ["[Conscience]"])?.family).toBe("custom");
  });
});

describe("speakerColor", () => {
  test("the same name always gets the same colour from the palette", () => {
    const a = speakerColor("Gina Watson");
    expect(SPEAKER_COLORS as readonly string[]).toContain(a);
    expect(speakerColor("gina  watson")).toBe(a);
    expect(speakerColor("Gina Watson")).toBe(a);
  });

  test("inner voices take their family's colour", () => {
    expect(speakerColor("Logic")).toBe(INNER_VOICE_COLORS.intellect);
  });

  test("names spread over the palette", () => {
    const names = ["Ana", "Ben", "Cecilia", "Dmitri", "Eun-ji", "Farid", "Gina", "Hana", "Ivo", "Jun", "Kai", "Lena"];
    expect(new Set(names.map((name) => speakerColor(name))).size).toBeGreaterThan(3);
  });
});
