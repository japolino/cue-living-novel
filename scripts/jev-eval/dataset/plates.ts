import type { EvalPlate } from "../types.js";

/**
 * The user's sprite library plates (known places) offered for place reuse.
 * Several dataset scenes revisit one of them in other words; the others are
 * distractors (same place at another time, similar places).
 */
export const PLATES: EvalPlate[] = [
  { id: "cafe_rain_evening", location: "Moonbean Café", timeOfDay: "evening", weather: "rain", description: "a small corner café with warm pendant lamps, a wooden counter, a chalkboard menu and rain-streaked windows" },
  { id: "cafe_morning", location: "Moonbean Café", timeOfDay: "morning", weather: "clear", description: "a small corner café in bright morning sun, wooden counter, chalkboard menu, pastries in a glass case" },
  { id: "school_rooftop_afternoon", location: "Seiran High School rooftop", timeOfDay: "afternoon", weather: "clear", description: "a school rooftop with a chain-link fence, a water tank and a wide view of the town under a blue sky" },
  { id: "classroom_sunset", location: "Classroom 2-B, Seiran High", timeOfDay: "sunset", weather: null, description: "an empty classroom with rows of desks, a chalkboard and orange light through tall windows" },
  { id: "apartment_night", location: "Mira's apartment living room", timeOfDay: "night", weather: null, description: "a cramped living room with a low table, a lumpy couch, fairy lights and a city view" },
  { id: "forest_shrine_night", location: "Abandoned shrine in the cedar forest", timeOfDay: "night", weather: "fog", description: "a rotting wooden shrine among tall cedars, a broken torii gate, moss-covered stone lanterns, thick fog" },
  { id: "tavern_night", location: "The Gilded Boar tavern", timeOfDay: "night", weather: null, description: "a crowded fantasy tavern with long tables, a roaring fireplace, candles and a bard's corner" },
  { id: "throne_day", location: "Throne room of Castle Veyr", timeOfDay: "day", weather: null, description: "a vast hall with marble pillars, red banners, a high throne and sunlight through stained glass" },
  { id: "alley_night_rain", location: "Neon alley in the lower district", timeOfDay: "night", weather: "rain", description: "a narrow back alley with flickering neon signs, puddles, steam vents and overflowing dumpsters" },
  { id: "hospital_night", location: "St. Agnes Hospital, third-floor corridor", timeOfDay: "night", weather: null, description: "a long hospital corridor under humming fluorescent lights, plastic chairs, a vending machine" },
  { id: "beach_sunset", location: "Kaminari Beach", timeOfDay: "sunset", weather: "clear", description: "a sandy beach with gentle waves, a wooden pier and an orange sun sinking into the sea" },
  { id: "starship_bridge", location: "Bridge of the starship Halcyon", timeOfDay: null, weather: null, description: "a starship bridge with curved consoles, blue holographic displays and a wide viewport onto space" },
  { id: "library_evening", location: "Ashford Town Library reading room", timeOfDay: "evening", weather: null, description: "a quiet reading room with tall oak shelves, green banker's lamps and long tables" },
  { id: "park_spring_morning", location: "Riverside Park", timeOfDay: "morning", weather: "clear", description: "a riverside park path lined with blooming cherry trees, benches and a stone bridge" },
  { id: "station_night_snow", location: "Kitamura Station platform", timeOfDay: "night", weather: "snow", description: "an open-air train platform with a yellow line, a vending machine, falling snow and a single lamp" },
  { id: "manor_storm_night", location: "Ashgrove Manor entrance hall", timeOfDay: "night", weather: "thunderstorm", description: "a dark manor hall with a double staircase, dusty portraits, a dead chandelier, lightning in the windows" },
];
