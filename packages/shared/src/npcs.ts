import type { Npc, NpcId } from './dialogue';

// Draft dialogue. Pidgin and Lagos slang should be reviewed by a native speaker before release.
// All characters are fictional.

export const NPCS: Record<NpcId, Npc> = {
  mama_nkechi: {
    id: 'mama_nkechi',
    name: 'Mama Nkechi',
    role: 'Runs the food stall',
    near: 'food_stall',
    greetings: [
      { minRelationship: 0, node: 'hello' },
      { minRelationship: 25, node: 'regular' },
    ],
    nodes: {
      hello: {
        text: 'Ah, new face! Welcome o. Na Mama Nkechi be this. My rice fit wake dead person. You wan chop?',
        choices: [
          { text: 'Mama, here is your money from yesterday.', requires: [{ kind: 'flag', key: 'mama_credit', is: true }, { kind: 'money', min: 1500 }], effects: [{ kind: 'money', delta: -1500 }, { kind: 'flag', key: 'mama_credit', value: false }, { kind: 'relationship', delta: 8 }], next: 'paid' },
          { text: 'Mama, your food dey smell well well.', oncePerDay: true, effects: [{ kind: 'relationship', delta: 5 }], next: 'flattered' },
          { text: 'How market today?', oncePerDay: true, effects: [{ kind: 'relationship', delta: 3 }], next: 'market' },
          { text: 'I dey go. Later, Mama.' },
        ],
      },
      flattered: {
        text: 'See this one with sweet mouth! Na so dem dey start. Come back anytime, you hear?',
        choices: [{ text: 'Thank you ma.' }],
      },
      market: {
        text: 'Market? Hmm. Pepper don cost pass gold. Tomatoes sef, na like say dem dey import am from London. But we dey manage.',
        choices: [{ text: 'God go provide.' }, { text: 'Manage am, Mama.' }],
      },
      regular: {
        text: 'My customer! You don come again. Today I go add extra meat for you, no tell anybody.',
        choices: [
          { text: 'Mama, here is your money from yesterday.', requires: [{ kind: 'flag', key: 'mama_credit', is: true }, { kind: 'money', min: 1500 }], effects: [{ kind: 'money', delta: -1500 }, { kind: 'flag', key: 'mama_credit', value: false }, { kind: 'relationship', delta: 8 }], next: 'paid' },
          { text: 'Abeg Mama, give me rice on credit. I go pay tomorrow.', requires: [{ kind: 'relationship', min: 40 }, { kind: 'flag', key: 'mama_credit', is: false }], oncePerDay: true, effects: [{ kind: 'item', item: 'rice_and_stew', delta: 1 }, { kind: 'flag', key: 'mama_credit', value: true }], next: 'credit' },
          { text: 'Mama, you be my person.', oncePerDay: true, effects: [{ kind: 'relationship', delta: 3 }] },
          { text: 'Make I dey go.' },
        ],
      },
      credit: {
        text: 'Ehen. I don hear. Tomorrow o! No let me come find you for your house.',
        choices: [{ text: 'I no go disappoint you.' }],
      },
      paid: {
        text: 'See correct person! This one na who I fit trust. God bless you.',
        choices: [{ text: 'Na you dey bless me, Mama.' }],
      },
    },
  },

  oga_bayo: {
    id: 'oga_bayo',
    name: 'Oga Bayo',
    role: 'Your manager at the office',
    near: 'office',
    greetings: [
      { minRelationship: 0, node: 'hello' },
      { minRelationship: 30, node: 'trusted' },
    ],
    nodes: {
      hello: {
        text: 'You again. In this office we resume by eight sharp, not African time. Are you here to work or to admire the AC?',
        choices: [
          { text: "Good morning, sir. I'm ready to work.", oncePerDay: true, effects: [{ kind: 'relationship', delta: 4 }], next: 'ready' },
          { text: 'Sir, is there any chance of a raise?', next: 'raise' },
          { text: "Sorry sir, I'll be on my way." },
        ],
      },
      ready: {
        text: "Good. Keep that energy. Those files on your desk won't arrange themselves.",
        choices: [{ text: 'Yes sir.' }],
      },
      raise: {
        text: "Raise? You haven't even finished one month and you're talking about raise. Show me results first.",
        choices: [
          { text: 'Understood, sir.' },
          { text: 'Others got raises, sir.', effects: [{ kind: 'relationship', delta: -5 }], next: 'cheeky' },
        ],
      },
      cheeky: {
        text: 'Others? Are you their lawyer? Go and do your work.',
        choices: [{ text: '...Yes sir.' }],
      },
      trusted: {
        text: 'Ah, my hardworking staff. Management noticed your reports. Keep it up and there may be something for you at month end.',
        choices: [
          { text: 'Thank you sir. Could I get a small salary advance?', requires: [{ kind: 'relationship', min: 45 }, { kind: 'flag', key: 'oga_advance', is: false }], oncePerDay: true, effects: [{ kind: 'money', delta: 5000 }, { kind: 'flag', key: 'oga_advance', value: true }], next: 'advance' },
          { text: 'Thank you, sir.', oncePerDay: true, effects: [{ kind: 'relationship', delta: 2 }] },
        ],
      },
      advance: {
        text: "Five thousand. It comes out of your next pay, and I don't want to hear story.",
        choices: [{ text: 'Thank you, sir.' }],
      },
    },
  },

  tunde: {
    id: 'tunde',
    name: 'Tunde',
    role: 'Danfo conductor',
    near: 'bus_stop',
    greetings: [{ minRelationship: 0, node: 'hello' }],
    nodes: {
      hello: {
        text: 'Obalende! Ojuelegba! Oya enter, enter, we dey go now now! ... You dey enter or you dey look?',
        choices: [
          { text: 'How far, conductor? Wetin be your name?', oncePerDay: true, effects: [{ kind: 'relationship', delta: 4 }], next: 'name' },
          { text: 'Why fare don increase again?', next: 'fare' },
          { text: 'I never ready. Later.' },
        ],
      },
      name: {
        text: 'Na Tunde, but everybody dey call me Tunde Change. You know why? I no dey ever get change! You sabi this road?',
        choices: [{ text: "No, I'm new here.", next: 'advice' }, { text: 'I sabi am small.' }],
      },
      advice: {
        text: 'Listen. When you enter bus, hold your bag for front. Shine your eye for motor park, and if bus too cheap, no enter am. Na so one chance dey catch people.',
        choices: [{ text: 'Thank you, Tunde.', effects: [{ kind: 'relationship', delta: 2 }] }],
      },
      fare: {
        text: 'Na fuel price o! No be my fault. Na ogas dey collect, I just dey shout.',
        choices: [{ text: 'Na wa o.' }],
      },
    },
  },

  mallam_sani: {
    id: 'mallam_sani',
    name: 'Mallam Sani',
    role: 'Your neighbour',
    near: 'home',
    greetings: [{ minRelationship: 0, node: 'hello' }],
    nodes: {
      hello: {
        text: 'Ah, my neighbour. Sannu. How your people dey?',
        choices: [
          { text: 'They dey fine, Mallam. How your family?', oncePerDay: true, effects: [{ kind: 'relationship', delta: 4 }], next: 'family' },
          { text: 'Mallam, you need help with anything?', next: 'help' },
          { text: 'Sai anjima, Mallam.' },
        ],
      },
      family: {
        text: 'Alhamdulillah, everybody dey well. My daughter don finish her exams. Education na the real wealth. No let anybody deceive you.',
        choices: [{ text: 'I hear you, Mallam.' }],
      },
      help: {
        text: 'God bless you. My generator don pack up again. Help me push am go mechanic side?',
        choices: [
          { text: "No wahala, let's go.", requires: [{ kind: 'energy', min: 15 }], oncePerDay: true, effects: [{ kind: 'energy', delta: -15 }, { kind: 'relationship', delta: 10 }, { kind: 'item', item: 'gala', delta: 1 }], next: 'thanks' },
          { text: 'Sorry Mallam, I tire today.' },
        ],
      },
      thanks: {
        text: 'May God reward you. Take this Gala for your stomach.',
        choices: [{ text: 'Thank you, Mallam.' }],
      },
    },
  },

  kelz: {
    id: 'kelz',
    name: 'Kelz',
    role: 'Knows everybody',
    near: 'food_stall',
    greetings: [{ minRelationship: 0, node: 'hello' }],
    nodes: {
      hello: {
        text: 'My guy! See as you dey waka like person wey get future. You wan hammer?',
        choices: [
          { text: 'Hammer how?', next: 'pitch' },
          { text: 'Na who you be?', oncePerDay: true, effects: [{ kind: 'relationship', delta: 3 }], next: 'who' },
          { text: 'I no get time for you.', oncePerDay: true, effects: [{ kind: 'relationship', delta: -3 }] },
        ],
      },
      who: {
        text: 'Kelz. Everybody for Surulere know me. I sabi people, people sabi me. That na the real currency.',
        choices: [{ text: 'Okay o.' }],
      },
      pitch: {
        text: 'Office work? Six thousand a day? Guy, dem dey use you play. I fit show you how to make that one inside one hour. Small runs, nothing serious.',
        choices: [
          { text: 'Tell me more.', effects: [{ kind: 'flag', key: 'kelz_interest', value: true }, { kind: 'relationship', delta: 5 }], next: 'later' },
          { text: 'I no dey do runs. I dey my lane.', effects: [{ kind: 'relationship', delta: -2 }], next: 'shrug' },
        ],
      },
      later: {
        text: 'Ehen! Now you dey talk. No be today. When the time reach, I go find you.',
        choices: [{ text: 'I go dey wait.' }],
      },
      shrug: {
        text: 'No wahala. When that salary no reach, you go remember Kelz.',
        choices: [{ text: 'We go see.' }],
      },
    },
  },
};
