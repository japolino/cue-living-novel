import type { EvalReply } from "../types.js";

/** Part A: slice of life, romance, comedy. Labels are human judgement. */
export const REPLIES: EvalReply[] = [
  {
    id: "sol-moonbean-napkin",
    genre: "slice of life",
    person: "first",
    persona: "Ren",
    cast: [
      {name: "Hana", identity: "1girl, short black bob, brown eyes", attire: "green apron over a striped sweater"},
      {name: "Jun", identity: "1boy, messy blond hair, grey eyes", attire: "black barista apron, rolled-up sleeves"},
      {name: "Sora", identity: "1girl, long black hair, brown eyes, younger", attire: "yellow raincoat over a school uniform"},
    ],
    scenes: [
      {start: 0, location: "the little coffee place on the corner of Fifth", timeOfDay: "evening", weather: "rainy", lighting: "pendant lamps", description: "small café, rain streaking the front window, wooden counter, espresso machine", character: "Hana", cast: ["Hana", "Jun", "Sora"], light: "indoor_warm", lightOk: ["neutral"], plate: "cafe_rain_evening"},
    ],
    paragraphs: [
      {
        text: "The rain hasn't let up since four. I wipe the same spot on the counter for the third time, watching the drops race each other down the front window while the pendant lamps hum overhead. Ren is at his usual table by the radiator, and I don't look over. I'm not going to look over.",
        speaker: "", present: ["Hana"], chars: {Hana: {e: "looking_away_shyly", eo: ["nervous", "embarrassed", "idle"], i: 2}},
      },
      {
        text: "Jun leans against the espresso machine, arms folded. \"You know you're allowed to talk to customers, right? It's in the job description.\" He grins. \"Page one.\"",
        speaker: "Jun", present: ["Hana", "Jun"], chars: {Jun: {e: "smug", eo: ["smirk", "smile", "playful_winking"], i: 3}},
      },
      {
        text: "\"Shut up,\" I hiss, and flick a coffee bean at him. It misses by a mile. My face is doing that hot, stupid thing again.",
        speaker: "Hana", present: ["Hana", "Jun"], chars: {Hana: {e: "embarrassed", eo: ["flustered", "full_face_blush", "annoyed", "pouting"], em: "blush", emo: ["anger", "sweat", "none"], i: 3}}, km: {level: 1, standing: true, interaction: "none"},
      },
      {
        text: "My phone buzzes against the till. Sora. Of course it's Sora. \"Nee-chan, I missed the bus and I'm soaked and Mom's going to kill me,\" she wails through the speaker. \"Can I come hide at the café? Please? I'll be quiet. I'll be so quiet.\"",
        speaker: "Sora", present: ["Hana", "Jun"], chars: {Hana: {e: "annoyed", eo: ["bored", "idle", "thinking", "worried"], em: "sweat", emo: ["none", "ellipsis"], i: 2}}, km: {level: 1, standing: true, interaction: "none"},
      },
      {
        text: "\"You're never quiet,\" I tell her, but I'm already pulling a clean mug down from the shelf. \"Ten minutes. Use the back door.\" I hang up before she can thank me, because if she thanks me I'll go soft, and she knows it.",
        speaker: "Hana", present: ["Hana", "Jun"], chars: {Hana: {e: "idle", eo: ["smile", "annoyed", "smirk"], i: 2}},
      },
      {
        text: "Jun is watching me with that insufferable grin. \"Big sister mode. Cute.\" I don't dignify that with an answer. I turn back to the window instead, and that's when I see Ren get up. He pulls on his coat, leaves a folded napkin on the table, and nods at me on his way out into the rain.",
        speaker: "Jun", present: ["Hana", "Jun"], chars: {Jun: {e: "smug", eo: ["smirk", "smile"], i: 2}, Hana: {e: "disappointed", eo: ["sad", "surprised", "idle", "melancholic"], i: 2}}, km: {level: 1, standing: true, interaction: "none"},
      },
      {
        text: "The napkin has four words on it in blue ink. Same time tomorrow? Please. I read it twice. Then a third time. My chest does something complicated, and I have to press my lips together very hard so Jun won't see me smile.",
        speaker: "", cue: {character: "Hana", pose: "blushing_shyly"}, present: ["Hana", "Jun"], chars: {Hana: {e: "blushing_shyly", eo: ["happy_smiling", "smile", "flustered", "embarrassed", "looking_away_shyly"], em: "blush", emo: ["heart", "none"], i: 3}}, km: {level: 2, standing: false, interaction: "none"},
      },
      {
        text: "The back door bangs open. Sora stumbles in like a drowned cat, yellow raincoat streaming, sneakers squelching on the tile. \"I'm here! Did I miss anything? Why is your face red?\"",
        speaker: "Sora", cue: {character: "Sora", pose: "surprised"}, present: ["Hana", "Jun", "Sora"], chars: {Sora: {e: "curious", eo: ["excited", "happy_smiling", "surprised", "smile"], mo: ["hop", "bounce"], em: "question", emo: ["none", "exclaim"], i: 3}, Hana: {e: "flustered", eo: ["embarrassed", "surprised", "full_face_blush"], em: "blush", emo: ["sweat", "exclaim", "none"], i: 3}}, km: {level: 2, standing: true, interaction: "none"},
      },
      {
        text: "\"Nothing,\" I say, too fast. Jun laughs so hard he has to hold onto the counter. I hand Sora a towel and pretend, with all my heart, that the napkin isn't burning a hole in my apron pocket.",
        speaker: "Hana", present: ["Hana", "Jun", "Sora"], chars: {Hana: {e: "embarrassed", eo: ["flustered", "forced_smiling", "nervous"], em: "sweat", emo: ["blush", "none"], i: 3}, Jun: {e: "laughing", eo: ["giggling", "happy_smiling"], i: 4, io: [3, 4, 5]}}, km: {level: 1, standing: true, interaction: "none"},
      },
    ],
    notes: "first person (Hana narrates as I; her narration speaker is \"\"); revisit of cafe_rain_evening worded differently; Sora only on the phone at p3 (not present), arrives at p7; persona Ren leaves (not cast); suppressed smile at p6 (\"so Jun won't see me smile\"); 'I don't look over' negation.",
  },
  {
    id: "sol-river-ducks-bet",
    genre: "slice of life",
    person: "third",
    persona: "Mika",
    cast: [
      {name: "Yui", identity: "1girl, chestnut hair in a high ponytail, hazel eyes", attire: "pink running jacket, black leggings"},
      {name: "Okabe", identity: "old man, white hair, round glasses", attire: "tweed flat cap, brown cardigan"},
      {name: "Daichi", identity: "1boy, short brown hair, hazel eyes", attire: "white shirt, café apron"},
    ],
    scenes: [
      {start: 0, location: "the river path in the park", timeOfDay: "morning", weather: "clear skies", lighting: "soft morning sun", description: "cherry trees in full bloom along the river, wooden benches, an old stone bridge", character: "Yui", cast: ["Yui", "Okabe"], light: "day", lightOk: ["neutral"], plate: "park_spring_morning"},
      {start: 7, location: "Moonbean, the corner café", timeOfDay: "late afternoon", weather: "sunny", lighting: "low golden sun through the windows", description: "small café, wooden counter, chalkboard menu, sunlight striping the tables", character: "Daichi", cast: ["Yui", "Daichi"], light: "indoor_warm", lightOk: ["sunset", "day", "neutral"], plate: null},
    ],
    paragraphs: [
      {
        text: "Morning comes softly over the river. Cherry petals drift down onto the path in pink flurries, catch on the empty benches, and float away under the old stone bridge. A heron stands motionless in the shallows. For a moment there is nobody on the path at all, just the water and the blossoms and the distant hum of the city waking up.",
        speaker: "", present: [], km: {level: 2, levelOk: [1, 2], standing: false, interaction: "none"},
      },
      {
        text: "Then footsteps. Yui jogs into view, ponytail swinging, cheeks pink from the chill, and slows when she spots you on the bench. \"You actually came!\" She doubles over, hands on her knees, panting. \"I bet Daichi a whole melon bun you'd sleep in.\"",
        speaker: "Yui", present: ["Yui"], chars: {Yui: {e: "happy_smiling", eo: ["excited", "surprised", "smile", "exhausted"], mo: ["hop", "bounce"], i: 3}}, km: {level: 1, standing: false, interaction: "running", interactionOk: ["none"]},
      },
      {
        text: "She drops onto the bench beside you, still catching her breath. \"Okay. Okay. Five minutes. Then we do the second lap, and you don't get to complain.\"",
        speaker: "Yui", present: ["Yui"], chars: {Yui: {e: "smile", eo: ["happy_smiling", "exhausted", "smug"], i: 2}}, km: {level: 1, standing: false, interaction: "sitting_together", interactionOk: ["sitting"]},
      },
      {
        text: "An old man shuffles over from the next bench with a paper bag of breadcrumbs. Mr. Okabe. Everyone on this path knows Mr. Okabe. \"Young lady,\" he says gravely, \"you are scaring my ducks.\"",
        speaker: "Okabe", present: ["Yui", "Okabe"], chars: {Okabe: {e: "serious", eo: ["annoyed", "idle", "suspicious"], i: 2}}, km: {level: 1, levelOk: [0, 1, 2], standing: true, interaction: "none"},
      },
      {
        text: "Yui's mouth falls open. \"I am not! I've been nothing but polite to those ducks!\" One of the ducks, as if on cue, hisses at her. She scoots closer to you on the bench.",
        speaker: "Yui", present: ["Yui", "Okabe"], chars: {Yui: {e: "pouting", eo: ["surprised", "embarrassed", "annoyed", "scared"], mo: ["step_back", "none"], em: "sweat", emo: ["exclaim", "anger", "none"], i: 3}}, km: {level: 1, standing: false, interaction: "sitting_together", interactionOk: ["sitting", "none"]},
      },
      {
        text: "Mr. Okabe doesn't laugh. He doesn't even smile. But his eyes crinkle behind his glasses as he tips a handful of crumbs into her palm. \"Then make amends.\"",
        speaker: "Okabe", present: ["Yui", "Okabe"], chars: {Okabe: {e: "smile", eo: ["idle", "serious", "smirk"], i: 1, io: [1, 2]}},
      },
      {
        text: "By the time the second lap has been completely forgotten, Yui is crouched at the water's edge cooing at a duckling, and Mr. Okabe has wandered off along the river with his empty paper bag.",
        speaker: "", cue: {character: "Yui", pose: "happy_smiling"}, leaves: ["Okabe"], present: ["Yui"], chars: {Yui: {e: "happy_smiling", eo: ["smile", "joyful", "excited"], em: "heart", emo: ["music", "sparkle", "none"], i: 3}}, km: {level: 2, standing: false, interaction: "kneeling", interactionOk: ["sitting", "none"]},
      },
      {
        text: "Later that afternoon the sun slants low and golden through the windows of the Moonbean, laying long stripes across the tables. Daichi is behind the counter with his sleeves rolled up, and he spots his sister before the bell over the door has finished jingling. \"Well, well. Somebody owes me a melon bun.\"",
        speaker: "Daichi", present: ["Yui", "Daichi"], chars: {Daichi: {e: "smug", eo: ["smirk", "smile", "playful_winking"], i: 3}, Yui: {e: "pouting", eo: ["annoyed", "embarrassed", "idle"], i: 2}}, km: {level: 1, levelOk: [0, 1, 2], standing: true, interaction: "none"},
      },
      {
        text: "\"Oh, great,\" Yui deadpans, sliding onto a stool. \"He remembers bets. He doesn't remember Mom's birthday, but he remembers bets.\" She slaps a coin on the counter without looking at him.",
        speaker: "Yui", present: ["Yui", "Daichi"], chars: {Yui: {e: "annoyed", eo: ["bored", "indifferent", "pouting"], i: 2}}, km: {level: 1, standing: false, interaction: "sitting", interactionOk: ["none"]},
      },
      {
        text: "Daichi slides the bun across anyway, on the house, and something in Yui's face softens. She tears it in half and pushes the bigger piece toward you.",
        speaker: "", present: ["Yui", "Daichi"], chars: {Yui: {e: "smile", eo: ["happy_smiling", "relieved"], i: 2}, Daichi: {e: "smile", eo: ["smug", "idle", "smirk"], i: 2}}, km: {level: 1, levelOk: [0, 1, 2], standing: true, interaction: "none"},
      },
    ],
    notes: "revisit of park_spring_morning (worded differently); p0 pure scenery, nobody present; Okabe leaves at p6; scene change at p7 to the same café as cafe_rain_evening/cafe_morning but late afternoon sun (distractor, plate null); deadpan sarcasm at p8 ('Oh, great' = annoyed, not happy); negated smile with crinkling eyes at p5 (subtle smile).",
  },
  {
    id: "rom-rooftop-confession",
    genre: "romance",
    person: "third",
    persona: "Haruto",
    cast: [
      {name: "Akari", identity: "1girl, long red hair, amber eyes", attire: "sailor school uniform, loose red ribbon"},
      {name: "Kenta", identity: "1boy, buzz cut, tall", attire: "school uniform with open jacket"},
      {name: "Nanami", identity: "1girl, short blue hair, glasses", attire: "school uniform, cardigan"},
    ],
    scenes: [
      {start: 0, location: "up on the roof of the high school", timeOfDay: "afternoon", weather: "clear, blue sky", lighting: "bright afternoon sun", description: "school roof behind a chain-link fence, water tank, the whole town spread out below", character: "Akari", cast: ["Akari", "Kenta"], light: "day", lightOk: ["neutral"], plate: "school_rooftop_afternoon"},
    ],
    paragraphs: [
      {
        text: "The rooftop door groans shut behind you. Up here the wind smells like warm concrete and someone's forgotten lunch, and the whole town spreads out beyond the chain-link fence under a sky so blue it almost hurts. Akari is already waiting by the water tank, and she doesn't turn around.",
        speaker: "", present: ["Akari"], chars: {Akari: {e: "nervous", eo: ["worried", "idle", "looking_away_shyly"], i: 2}}, km: {level: 1, standing: true, interaction: "none"},
      },
      {
        text: "\"You came,\" she says to the fence. Her fingers are hooked through the wire, knuckles white. \"Nanami said you wouldn't. She said I'd chicken out first, anyway, so.\" A breath. \"Joke's on her.\"",
        speaker: "Akari", present: ["Akari"], chars: {Akari: {e: "nervous", eo: ["forced_smiling", "worried", "determined"], em: "sweat", emo: ["none"], i: 3}},
      },
      {
        text: "She finally turns. Her cheeks are already pink, and she's trying very hard to look annoyed about it. \"Don't look at me like that. I haven't even said anything yet.\"",
        speaker: "Akari", present: ["Akari"], chars: {Akari: {e: "embarrassed", eo: ["flustered", "pouting", "blushing_shyly", "annoyed"], em: "blush", emo: ["anger", "none"], i: 3}}, km: {level: 1, standing: true, interaction: "none"},
      },
      {
        text: "Behind you, the door creaks. Kenta's buzz-cut head pokes through the gap, takes one look at Akari's face, and his eyes go huge. \"Oh. Oh no. Wrong roof. Wrong everything. I was never here.\" The door clicks shut again.",
        speaker: "Kenta", leaves: ["Kenta"], present: ["Akari", "Kenta"], chars: {Kenta: {e: "surprised", eo: ["shocked", "nervous", "embarrassed"], m: "step_back", mo: ["none", "turn_away"], em: "exclaim", emo: ["sweat", "none"], i: 4, io: [3, 4, 5]}, Akari: {e: "full_face_blush", eo: ["embarrassed", "flustered", "surprised", "shocked"], em: "blush", emo: ["exclaim", "sweat"], i: 4, io: [3, 4, 5]}}, km: {level: 2, levelOk: [1, 2], standing: true, interaction: "none"},
      },
      {
        text: "Akari stares at the door. Then she makes a sound somewhere between a laugh and a groan and covers her face with both hands. \"I'm going to kill him. Tomorrow. Today I'm busy.\"",
        speaker: "Akari", present: ["Akari"], chars: {Akari: {e: "full_face_blush", eo: ["embarrassed", "flustered", "giggling", "blushing_shyly"], em: "sweat", emo: ["blush", "anger", "none"], i: 4, io: [3, 4]}}, km: {level: 1, standing: true, interaction: "none"},
      },
      {
        text: "Her hands come down. Whatever she has been holding back all week is in her eyes now, bright and frightened and stubborn. \"I like you. Not like a friend. I've liked you since the culture festival, when you carried all those chairs by yourself and pretended it was no big deal, and I'm...\" Her voice cracks. She refuses to look away. \"I'm really scared right now, so please say something.\"",
        speaker: "Akari", cue: {character: "Akari", pose: "blushing_shyly"}, present: ["Akari"], chars: {Akari: {e: "nervous", eo: ["blushing_shyly", "determined", "scared", "pleading", "flustered", "teary_pouting"], mo: ["tremble", "none"], em: "blush", emo: ["sweat", "none"], i: 4, io: [3, 4, 5]}}, km: {level: 3, standing: true, interaction: "none", interactionOk: ["looking_at_each_other"]},
      },
      {
        text: "You tell her. It doesn't take many words. For a second Akari just blinks, like the sentence hasn't landed yet, and then her face crumples and she laughs, wet and helpless, tears spilling over even as she grins. \"Seriously? You're serious? Oh my god. I'm crying. Why am I crying, this is the good outcome!\"",
        speaker: "Akari", present: ["Akari"], chars: {Akari: {e: "happy_tears", eo: ["crying_with_eyes_open", "laughing", "joyful"], em: "none", emo: ["heart", "sparkle", "blush"], i: 4, io: [4, 5]}}, km: {level: 3, standing: true, interaction: "none"},
      },
      {
        text: "She closes the distance in two quick steps and throws her arms around you, face buried against your shoulder, still laughing, still crying, her red hair whipping around both of you in the wind.",
        speaker: "", cue: {character: "Akari", pose: "crying_with_eyes_open"}, present: ["Akari"], chars: {Akari: {e: "happy_tears", eo: ["crying_with_eyes_closed", "joyful", "crying_with_eyes_open"], m: "lean_in", mo: ["none"], em: "heart", emo: ["none", "blush"], i: 4, io: [4, 5]}}, km: {level: 4, standing: false, interaction: "hug", interactionOk: ["crying_on_shoulder"]},
      },
      {
        text: "When she finally pulls back her nose is red, her eyes are puffy, and she looks, honestly, a mess. She scrubs her face with her sleeve and glares at you without any heat at all. \"If you tell Nanami I cried, I'm breaking up with you. We've been dating for one minute. I'll do it.\"",
        speaker: "Akari", present: ["Akari"], chars: {Akari: {e: "pouting", eo: ["teary_pouting", "embarrassed", "smile", "flustered"], em: "blush", emo: ["none", "anger"], i: 3}}, km: {level: 1, standing: true, interaction: "none"},
      },
    ],
    notes: "revisit of school_rooftop_afternoon (worded differently); Nanami is a cast member only talked about (never present); Kenta pokes his head in and leaves within p3 (labelled present at p3 since he is briefly in view; planner leaves=Kenta there); confession with mixed fear/determination (p5), happy tears (p6), hug as defining moment (p7); 'refuses to look away', 'glares without any heat' (mock anger = pouting).",
  },
  {
    id: "rom-rooftop-stars-first",
    genre: "romance",
    person: "first",
    persona: "Kaito",
    cast: [
      {name: "Shion", identity: "1girl, long silver hair, violet eyes", attire: "school blazer over a grey hoodie, plaid skirt"},
      {name: "Kuroda", identity: "old man, grey stubble, stocky", attire: "night guard uniform, cap, flashlight"},
    ],
    scenes: [
      {start: 0, location: "the north stairwell of Seiran High", timeOfDay: "night", weather: null, lighting: "green exit sign", description: "dark school stairwell, dusty steps, a locked rooftop door", character: "Shion", cast: ["Shion"], light: "dark", lightOk: ["indoor_cool", "night"], plate: null},
      {start: 2, location: "the school roof", timeOfDay: "night", weather: "clear and cold", lighting: "moonlight and town lights", description: "chain-link fence, water tank, the town lit up below a sky full of stars", character: "Shion", cast: ["Shion", "Kuroda"], light: "night", lightOk: ["dark"], plate: null},
    ],
    paragraphs: [
      {
        text: "I've never broken a school rule in my life. Not one. So naturally my hands are shaking so badly that it takes me three tries to fit the borrowed key into the rooftop door, while the exit sign paints everything a sickly green and Kaito holds his phone light over my shoulder.",
        speaker: "", present: ["Shion"], chars: {Shion: {e: "nervous", eo: ["scared", "worried"], m: "tremble", mo: ["none"], em: "sweat", emo: ["none"], i: 3}}, km: {level: 1, levelOk: [1, 2], standing: false, interaction: "none"},
      },
      {
        text: "\"If you're getting cold feet,\" he whispers, \"we can still go back.\" \"I'm not getting cold feet.\" I am absolutely getting cold feet. The lock turns with a clunk that echoes down four floors, and we both freeze.",
        speaker: "Shion", present: ["Shion"], chars: {Shion: {e: "nervous", eo: ["scared", "surprised", "determined"], mo: ["tremble", "none"], em: "sweat", emo: ["exclaim", "none"], i: 3}}, km: {level: 1, standing: true, interaction: "none"},
      },
      {
        text: "Then the door swings open, and the night is just there. The wind tugs at the fence. Below us the whole town is a spill of lights, the station, the shopping street, the red blink of the radio tower, and above it more stars than I knew our sky was allowed to have.",
        speaker: "", present: ["Shion"], chars: {Shion: {e: "admiring", eo: ["surprised", "excited", "happy_smiling", "smile"], em: "sparkle", emo: ["none"], i: 3}}, km: {level: 2, levelOk: [1, 2], standing: false, interaction: "none"},
      },
      {
        text: "\"Oh,\" I say, very intelligently. I forget to be scared. I forget the key in my fist and the guard's rounds and the math test at nine tomorrow. I walk right up to the fence and hook my fingers through it like a little kid.",
        speaker: "Shion", present: ["Shion"], chars: {Shion: {e: "admiring", eo: ["excited", "happy_smiling", "surprised"], mo: ["lean_in", "none"], em: "sparkle", emo: ["none"], i: 3}}, km: {level: 1, standing: true, interaction: "none"},
      },
      {
        text: "Kaito doesn't say anything for a long time. When I finally glance over, he isn't looking at the town. He's looking at me. My heart does a stupid little skip, and I very carefully do not smile.",
        speaker: "", present: ["Shion"], chars: {Shion: {e: "flustered", eo: ["blushing_shyly", "looking_away_shyly", "embarrassed"], em: "blush", emo: ["heart", "none"], i: 3, io: [2, 3, 4]}}, km: {level: 2, standing: true, interaction: "looking_at_each_other", interactionOk: ["none"]},
      },
      {
        text: "\"What,\" I say. \"You're staring.\" \"Yeah,\" he says, and doesn't stop. He reaches up and tucks a strand of my hair back where the wind pulled it loose, and his fingers are cold, and I can't breathe properly.",
        speaker: "Kaito", present: ["Shion"], chars: {Shion: {e: "flustered", eo: ["full_face_blush", "blushing_shyly", "lovestruck"], em: "blush", emo: ["heart"], i: 4, io: [3, 4, 5]}}, km: {level: 2, standing: false, interaction: "looking_at_each_other", interactionOk: ["none"]},
      },
      {
        text: "I kiss him. I don't plan it. It isn't graceful: I bump his nose and I'm up on my tiptoes and the fence rattles behind me, but he laughs against my mouth and kisses me back, and the whole town glitters underneath us like it's holding its breath.",
        speaker: "", cue: {character: "Shion", pose: "lovestruck"}, present: ["Shion"], chars: {Shion: {e: "lovestruck", eo: ["blushing_shyly", "flustered", "happy_smiling", "full_face_blush"], m: "lean_in", mo: ["none"], em: "heart", emo: ["blush", "none"], i: 4}}, km: {level: 4, standing: false, interaction: "kiss"},
      },
      {
        text: "A beam of white light sweeps across the water tank. Footsteps on the stairs. \"Who's up there?\" a gravelly voice calls, and old Mr. Kuroda, the night guard, steps out onto the roof flashlight first, cap askew.",
        speaker: "Kuroda", present: ["Shion", "Kuroda"], chars: {Kuroda: {e: "suspicious", eo: ["angry", "serious", "annoyed"], i: 3}, Shion: {e: "shocked", eo: ["scared", "surprised", "nervous"], m: "step_back", mo: ["none", "tremble"], em: "exclaim", emo: ["sweat"], i: 4}}, km: {level: 2, levelOk: [1, 2], standing: true, interaction: "none"},
      },
      {
        text: "We don't wait to find out whether he recognizes us. I grab Kaito's hand and we bolt down the far stairs two at a time, my laughter bouncing off every landing until the guard's shouting is just a faraway echo. I have never broken a school rule in my life. I think I'm going to start.",
        speaker: "", cue: {character: "Shion", pose: "excited"}, present: ["Shion"], chars: {Shion: {e: "laughing", eo: ["happy_smiling", "excited", "joyful"], mo: ["bounce", "hop", "none"], em: "none", emo: ["music", "sparkle", "heart"], i: 4}}, km: {level: 3, standing: false, interaction: "running", interactionOk: ["holding_hands"]},
      },
    ],
    notes: "first person (Shion narrates as I); scene change stairwell -> rooftop at p2; rooftop at NIGHT is a distractor for school_rooftop_afternoon (plate null); 'cold feet' idiom, 'I very carefully do not smile' negation (p4); Kuroda arrives only at p7 and is left behind at p8 (planner misses the departure); kiss is the defining moment.",
  },
  {
    id: "com-omelette-alarm",
    genre: "comedy",
    person: "third",
    persona: "Sam",
    cast: [
      {name: "Toby", identity: "1boy, curly orange hair, freckles", attire: "'Kiss the Cook' apron over a T-shirt"},
      {name: "Rika", identity: "1girl, black hair in a messy bun, half-lidded eyes", attire: "oversized band T-shirt, sweatpants"},
      {name: "Mrs. Pike", identity: "old woman, grey hair in curlers, sharp nose", attire: "floral housecoat, slippers"},
    ],
    scenes: [
      {start: 0, location: "the roommates' tiny apartment kitchen", timeOfDay: "evening", weather: null, lighting: "flickering fluorescent tube", description: "cramped kitchen open to the living room, stacked dishes, a smoking frying pan, a lumpy couch", character: "Toby", cast: ["Toby", "Rika"], light: "indoor_cool", lightOk: ["indoor_warm", "neutral"], plate: null},
    ],
    paragraphs: [
      {
        text: "The smoke alarm has been screaming for a full minute before anyone does anything about it. Toby is doing something about it, technically: he is waving a dish towel at the ceiling with the frantic energy of a man flagging down a rescue helicopter. \"It's fine! It's fine! This is part of the process!\"",
        speaker: "Toby", present: ["Toby"], chars: {Toby: {e: "nervous", eo: ["scared", "forced_smiling", "worried"], mo: ["bounce", "shake", "hop", "none"], em: "sweat", emo: ["exclaim"], i: 4, io: [3, 4, 5]}}, km: {level: 2, standing: false, interaction: "none"},
      },
      {
        text: "Rika doesn't get up from the couch across the room. She doesn't even look up from her phone. \"Oh, wonderful,\" she says, flat as a pancake, which, incidentally, is not what's on fire. \"Is the process burning down the building? Because I think it's working.\"",
        speaker: "Rika", present: ["Toby", "Rika"], chars: {Rika: {e: "bored", eo: ["indifferent", "annoyed", "idle"], i: 2}}, km: {level: 1, standing: false, interaction: "sitting", interactionOk: ["none"]},
      },
      {
        text: "\"You could help!\" \"I could,\" Rika agrees. She scrolls. \"Sam, could you help? I'm busy watching my rent deposit evaporate.\"",
        speaker: "Rika", present: ["Toby", "Rika"], chars: {Toby: {e: "pleading", eo: ["annoyed", "nervous", "angry"], em: "anger", emo: ["sweat", "none"], i: 3}},
      },
      {
        text: "You get the window open. Toby slaps a lid on the pan. The alarm cuts off mid-shriek, and in the ringing silence Rika finally wanders over to peer into the pan with the two of you. The blackened thing inside might once have been an omelette. It might once have been a shoe.",
        speaker: "", present: ["Toby", "Rika"], chars: {Toby: {e: "disappointed", eo: ["guilty", "exhausted", "embarrassed", "relieved"], em: "ellipsis", emo: ["sweat", "gloom", "none"], i: 3}, Rika: {e: "disgusted", eo: ["bored", "indifferent", "suspicious"], em: "ellipsis", emo: ["none"], i: 2}}, km: {level: 1, levelOk: [1, 2], standing: false, interaction: "none"},
      },
      {
        text: "Toby's shoulders sag. \"I wanted to make you guys breakfast-for-dinner. As a thank-you. For the thing.\" He sniffs, and for a second it looks like he might actually have to fight back tears over an omelette.",
        speaker: "Toby", present: ["Toby", "Rika"], chars: {Toby: {e: "teary_pouting", eo: ["sad", "disappointed", "guilty"], m: "sink", mo: ["none"], em: "gloom", emo: ["none", "sweat"], i: 3}}, km: {level: 1, standing: true, interaction: "none"},
      },
      {
        text: "Rika looks at him for a long, deadpan moment. Then she takes the spatula out of his hand, pries the omelette out of the pan, and takes a huge, crunchy bite. \"Mm,\" she says, chewing. \"Charcoal. My favorite.\"",
        speaker: "Rika", cue: {character: "Rika", pose: "smirk"}, present: ["Toby", "Rika"], chars: {Rika: {e: "idle", eo: ["bored", "indifferent", "smirk", "disgusted"], i: 2}, Toby: {e: "surprised", eo: ["shocked", "confused"], em: "exclaim", emo: ["question", "none"], i: 3}}, km: {level: 3, standing: false, interaction: "none"},
      },
      {
        text: "Before Toby can decide whether to laugh or cry, someone pounds on the front door hard enough to rattle the dish rack. \"THIS IS MRS. PIKE,\" a voice booms through the wood. \"I SMELL SMOKE. I AM COMING IN.\" Toby yelps and nearly drops the pan.",
        speaker: "Mrs. Pike", present: ["Toby", "Rika"], chars: {Toby: {e: "scared", eo: ["shocked", "surprised", "nervous"], m: "step_back", mo: ["tremble", "hop", "none"], em: "exclaim", emo: ["sweat"], i: 4}}, km: {level: 1, standing: true, interaction: "none"},
      },
      {
        text: "The door swings open and the landlady sweeps in, curlers bristling, housecoat billowing, nose held high like a bloodhound's. Her eyes go from the smoke to the open window to the black crumbs on Rika's chin. \"Explain,\" she says.",
        speaker: "Mrs. Pike", present: ["Toby", "Rika", "Mrs. Pike"], chars: {"Mrs. Pike": {e: "suspicious", eo: ["angry", "annoyed", "serious"], i: 4, io: [3, 4]}}, km: {level: 2, levelOk: [1, 2], standing: true, interaction: "none"},
      },
      {
        text: "Rika swallows. Without a flicker of expression, she holds out the rest of the omelette. \"Snack?\" Toby makes a tiny, strangled noise and hides his face in the dish towel.",
        speaker: "Rika", present: ["Toby", "Rika", "Mrs. Pike"], chars: {Rika: {e: "indifferent", eo: ["idle", "bored", "smug"], i: 2}, Toby: {e: "full_face_blush", eo: ["embarrassed", "scared", "nervous"], em: "sweat", emo: ["ellipsis", "gloom", "none"], i: 4, io: [3, 4, 5]}}, km: {level: 2, levelOk: [1, 2], standing: true, interaction: "none"},
      },
    ],
    notes: "deadpan/sarcasm (Rika: 'Oh, wonderful', 'Charcoal. My favorite.' = bored/idle, not happy); Mrs. Pike only a voice through the door at p6 (not present), arrives at p7; 'fight back tears' idiom (teary_pouting, not crying); Rika on the couch at p1 (sitting); no level 4.",
  },
  {
    id: "com-karaoke-ballad",
    genre: "comedy",
    person: "third",
    persona: "Jess",
    cast: [
      {name: "Noa", identity: "1girl, pink twin tails, bright blue eyes", attire: "glittery crop top, denim skirt"},
      {name: "Goro", identity: "1boy, very tall, broad shoulders, short black hair", attire: "white button-up shirt buttoned to the collar"},
      {name: "Benji", identity: "1boy, bleached hair, earrings", attire: "smoothie-stand polo shirt"},
    ],
    scenes: [
      {start: 0, location: "a private karaoke room on the shopping street", timeOfDay: "night", weather: null, lighting: "disco ball and a glowing TV screen", description: "tiny karaoke booth, red vinyl couch, two microphones, a tambourine, a giant screen", character: "Noa", cast: ["Noa", "Goro", "Benji"], light: "indoor_cool", lightOk: ["dark", "indoor_warm", "neutral"], plate: null},
    ],
    paragraphs: [
      {
        text: "The karaoke room is the size of a closet and smells like fried chicken and someone's strawberry vape. A disco ball turns lazily over the empty vinyl couch. On the giant screen, a pop idol from 2009 dances in total silence, waiting for somebody to come in and pick up a microphone.",
        speaker: "", present: [], km: {level: 1, standing: false, interaction: "none"},
      },
      {
        text: "Noa bursts in behind you with a tray of drinks and the confidence of a general. \"Okay! Benji's running late, but that's fine, because Goro is here, and Goro is GREAT.\" She shoves the tray onto the table and turns a megawatt smile on the tall, silent guy hovering in the doorway. \"Right, Goro?\"",
        speaker: "Noa", present: ["Noa", "Goro"], chars: {Noa: {e: "happy_smiling", eo: ["excited", "smug", "forced_smiling", "smile"], mo: ["bounce", "none"], em: "sparkle", emo: ["none", "music"], i: 4, io: [3, 4]}, Goro: {e: "nervous", eo: ["looking_away_shyly", "idle", "embarrassed"], i: 2}}, km: {level: 1, levelOk: [0, 1, 2], standing: true, interaction: "none"},
      },
      {
        text: "Goro, who is roughly the size of a vending machine, nods once. He doesn't smile. He doesn't sit, either. He just stands there with his collar buttoned all the way up, gripping a can of melon soda like it's the only thing anchoring him to the earth.",
        speaker: "", present: ["Noa", "Goro"], chars: {Goro: {e: "nervous", eo: ["idle", "indifferent", "scared", "worried"], m: "nod", mo: ["none"], em: "sweat", emo: ["ellipsis", "none"], i: 3}}, km: {level: 1, levelOk: [0, 1, 2], standing: true, interaction: "none"},
      },
      {
        text: "Noa's phone buzzes. She reads the message and her heart visibly sinks. \"Benji says he's 'stuck at work.' Benji works at a smoothie stand. It closed an hour ago.\" She types back furiously, thumbs jabbing.",
        speaker: "Noa", present: ["Noa", "Goro"], chars: {Noa: {e: "disappointed", eo: ["annoyed", "angry", "sad"], em: "anger", emo: ["gloom", "none"], i: 3}}, km: {level: 1, levelOk: [0, 1, 2], standing: true, interaction: "none"},
      },
      {
        text: "\"Wow,\" she says brightly, putting the phone face-down. \"Great. Love that for us.\" Her smile could cut glass.",
        speaker: "Noa", present: ["Noa", "Goro"], chars: {Noa: {e: "forced_smiling", eo: ["annoyed", "angry"], em: "anger", emo: ["none", "sweat"], i: 3}},
      },
      {
        text: "The silence stretches. The idol on the screen finishes her soundless dance and starts again. Then, very slowly, Goro sets down his soda, picks up the microphone, and scrolls to a song. The opening bars of an extremely dramatic power ballad fill the room.",
        speaker: "", present: ["Noa", "Goro"], chars: {Goro: {e: "determined", eo: ["serious", "nervous", "idle"], i: 3}, Noa: {e: "surprised", eo: ["confused", "curious", "shocked"], em: "question", emo: ["exclaim", "none"], i: 3}}, km: {level: 2, levelOk: [1, 2], standing: false, interaction: "none"},
      },
      {
        text: "He sings the whole thing. With his eyes closed. With one fist pressed to his heart on the key change. He is, to everyone's shock, phenomenal, and Noa's jaw is hanging open somewhere near the floor.",
        speaker: "", cue: {character: "Goro", pose: "determined"}, present: ["Noa", "Goro"], chars: {Goro: {e: "determined", eo: ["serious", "proud"], em: "music", emo: ["sparkle", "none"], i: 4, io: [3, 4, 5]}, Noa: {e: "shocked", eo: ["surprised", "admiring"], em: "exclaim", emo: ["sparkle", "none"], i: 4}}, km: {level: 4, standing: false, interaction: "none"},
      },
      {
        text: "When the last note fades, Goro lowers the mic and looks at the floor, ears red. \"...Sorry. That one's my favorite.\" Noa bursts out laughing, not at him, she's quick to wave her hands, and that, more than anything, breaks the ice.",
        speaker: "Goro", present: ["Noa", "Goro"], chars: {Goro: {e: "embarrassed", eo: ["blushing_shyly", "looking_away_shyly"], em: "blush", emo: ["sweat", "none"], i: 3}, Noa: {e: "laughing", eo: ["happy_smiling", "giggling", "joyful"], mo: ["shake", "none"], i: 4, io: [3, 4, 5]}}, km: {level: 1, levelOk: [0, 1, 2], standing: true, interaction: "none"},
      },
      {
        text: "\"Okay, new rule,\" she announces, grabbing the second mic and the tambourine. \"Benji is dead to me, and Goro picks every song for the rest of the night.\" She hops up onto the couch cushions like a kid. \"Jess! Duet! Get up here!\"",
        speaker: "Noa", present: ["Noa", "Goro"], chars: {Noa: {e: "excited", eo: ["happy_smiling", "joyful", "laughing"], m: "hop", mo: ["bounce", "none"], em: "music", emo: ["sparkle", "none"], i: 4, io: [3, 4, 5]}}, km: {level: 2, levelOk: [1, 2], standing: false, interaction: "none", interactionOk: ["dancing"]},
      },
    ],
    notes: "p0 empty room (scenery, nobody present); Benji is a cast member who never shows up (only texts; planner still lists him in the scene cast); 'heart sinks', 'breaks the ice' idioms; sarcasm 'Love that for us' with a forced smile; negations 'doesn't smile', 'doesn't sit'; the ballad is the defining picture.",
  },
];
