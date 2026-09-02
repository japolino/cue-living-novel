import { VnStage } from "./frontend/stage/index.js";
import { isThemePresetId } from "./frontend/theme/presets.js";

function sceneDataUrl(colors: [string, string], label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient>
      <radialGradient id="glow"><stop stop-color="#ffe9a8" stop-opacity=".9"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#sky)"/>
    <circle cx="1240" cy="170" r="220" fill="url(#glow)"/>
    <path d="M0 590 Q260 420 520 590 T1040 560 T1600 570 V900 H0Z" fill="#0b1724" opacity=".78"/>
    <path d="M0 690 Q300 570 650 690 T1300 650 T1600 670 V900 H0Z" fill="#071019" opacity=".96"/>
    <ellipse cx="800" cy="865" rx="220" ry="38" fill="#03060b" opacity=".55"/>
    <path d="M735 710 Q710 555 750 400 Q800 310 850 400 Q890 555 865 710Z" fill="#14111f"/>
    <circle cx="800" cy="330" r="86" fill="#e8c1ae"/>
    <path d="M714 335 Q715 215 800 220 Q900 220 886 355 Q850 300 770 295Z" fill="#181226"/>
    <path d="M755 405 Q800 445 845 405 L895 690 Q800 745 705 690Z" fill="#6c254d"/>
    <text x="70" y="90" fill="#fff" opacity=".55" font-family="system-ui" font-size="32">${label}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const mount = document.querySelector<HTMLElement>("#preview");
if (!mount) throw new Error("Preview mount is missing.");

const firstScene = sceneDataUrl(["#402b63", "#d77d72"], "Sunset overlook");
const secondScene = sceneDataUrl(["#07152f", "#31527d"], "Night overlook");
const query = new URLSearchParams(location.search);
const mode = query.get("mode") === "standard" ? "standard" : "cyoa";
const requestedPreset = query.get("preset");
const themePreset = isThemePresetId(requestedPreset) ? requestedPreset : "lumiverse";

const stage = new VnStage({
  mount,
  themePreset,
  userCss: themePreset === "lumiverse" ? `
    [data-vn-dialogue] { border-color: rgba(255, 218, 239, .48); }
    [data-vn-speaker] { letter-spacing: .08em; text-transform: uppercase; }
  ` : "",
  onAdvance: (paragraphIndex) => {
    if (paragraphIndex === 1) {
      window.setTimeout(() => {
        void stage.setSceneImage({ url: secondScene, requestId: "night-scene", alt: "The overlook after nightfall" });
      }, 700);
    }
  },
  onChoice: async (choice) => {
    stage.setActivity(`Selected: ${choice.label}`);
  },
  onSubmit: async (text) => {
    stage.setActivity(`Submitted: ${text}`);
  },
  onExit: () => stage.setActivity("Exit would restore Lumiverse chat.")
});

stage.loadTurn({
  mode,
  paragraphs: [
    { id: "p0", speaker: "Mira", text: "The last sunlight spills across the valley. For a moment, neither of us says anything." },
    { id: "p1", speaker: "Mira", text: "By the time she turns toward you, the first stars have appeared over the ridge." },
    { id: "p2", speaker: "Mira", text: "So, she asks quietly, where do we go from here?" }
  ],
  choices: [
    { id: "stay", label: "Stay until sunrise", value: "Let's stay here until sunrise." },
    { id: "return", label: "Head back together", value: "We should head back together." },
    { id: "ask", label: "Ask what she wants", value: "What do you want to do?" }
  ]
});
void stage.setSceneImage({ url: firstScene, requestId: "sunset-scene", alt: "A sunset overlook" });

Object.assign(globalThis, { __visualNovelPreview: stage });
