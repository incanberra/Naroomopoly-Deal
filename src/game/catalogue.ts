export const SETS = {
  brown: {
    name: 'Bay beginnings',
    color: '#986747',
    size: 2,
    value: 1,
    rent: [1, 2],
    places: ['Nelligen', 'Long Beach'],
  },
  lightBlue: {
    name: 'Beach days',
    color: '#83c7d4',
    size: 3,
    value: 1,
    rent: [1, 2, 3],
    places: ['Surf Beach', 'Denhams Beach', 'Batehaven'],
  },
  pink: {
    name: 'Hidden coves',
    color: '#d47d9f',
    size: 3,
    value: 2,
    rent: [1, 2, 4],
    places: ['Lillipilli', 'Malua Bay', 'Guerilla Bay'],
  },
  orange: {
    name: 'River meets sea',
    color: '#de8a4c',
    size: 3,
    value: 2,
    rent: [1, 3, 5],
    places: ['Tomakin', 'Mossy Point', 'Broulee'],
  },
  red: {
    name: 'Village life',
    color: '#c7594e',
    size: 3,
    value: 3,
    rent: [2, 3, 6],
    places: ['Mogo Village', 'Moruya', 'Moruya Heads'],
  },
  yellow: {
    name: 'The quiet coast',
    color: '#dfbd4b',
    size: 3,
    value: 3,
    rent: [2, 4, 6],
    places: ['Congo', 'Meringo', 'Tuross'],
  },
  green: {
    name: 'Inlet country',
    color: '#579979',
    size: 3,
    value: 4,
    rent: [2, 4, 7],
    places: ['Kianga', 'Dalmeny', 'Wagonga Inlet'],
  },
  darkBlue: {
    name: 'Coastal icons',
    color: '#4b719e',
    size: 2,
    value: 4,
    rent: [3, 8],
    places: ['Australia Rock', 'Montague Island (Baranguba)'],
  },
  hardware: {
    name: 'Hardware run',
    color: '#686e74',
    size: 4,
    value: 2,
    rent: [1, 2, 3, 4],
    places: ['Bunnings Batemans Bay', 'Camerons Moruya', 'Woody’s', 'Mitre 10 Glasshouse Rocks'],
  },
  utility: {
    name: 'Keeping it running',
    color: '#a5aa76',
    size: 2,
    value: 2,
    rent: [1, 2],
    places: ['Eurobodalla Shire Water', 'Essential Energy'],
  },
} as const;
export type Color = keyof typeof SETS;
export const COLORS = Object.keys(SETS) as Color[];
export type Effect =
  | 'draw2'
  | 'rent'
  | 'doubleRent'
  | 'debt'
  | 'birthday'
  | 'steal'
  | 'swap'
  | 'takeSet'
  | 'no'
  | 'house'
  | 'hotel';
export interface Card {
  id: string;
  kind: 'property' | 'wild' | 'money' | 'action' | 'rent';
  name: string;
  subtitle: string;
  description: string;
  value: number;
  colors?: Color[];
  effect?: Effect;
  motif: 'coast' | 'knowledge' | 'notice';
}
export const ACTIONS: Record<
  Exclude<Effect, 'rent'>,
  { name: string; subtitle: string; description: string; value: number; count: number }
> = {
  draw2: {
    name: 'Welcome to the South Coast',
    subtitle: 'Pass Go',
    description: 'Draw two more cards. A fresh sea breeze for your hand.',
    value: 1,
    count: 10,
  },
  doubleRent: {
    name: 'Peak Summer Rates',
    subtitle: 'Double the Rent',
    description: 'Play with rent to double it. Each booster uses one play.',
    value: 1,
    count: 2,
  },
  debt: {
    name: 'Shire Rates Notice',
    subtitle: 'Debt Collector',
    description: 'One player owes you 5M. The council always remembers.',
    value: 3,
    count: 3,
  },
  birthday: {
    name: 'Oyster Festival Shout',
    subtitle: 'It’s My Birthday',
    description: 'Every other player owes you 2M. Your round, their shout.',
    value: 2,
    count: 3,
  },
  steal: {
    name: 'Facebook Marketplace Find',
    subtitle: 'Sly Deal',
    description: 'Take one property from an incomplete set.',
    value: 3,
    count: 3,
  },
  swap: {
    name: 'South Coast Property Swap',
    subtitle: 'Forced Deal',
    description: 'Swap one of your properties for one in an opponent’s incomplete set.',
    value: 3,
    count: 3,
  },
  takeSet: {
    name: 'Coastal Takeover',
    subtitle: 'Deal Breaker',
    description: 'Take a complete set, including its buildings.',
    value: 5,
    count: 2,
  },
  no: {
    name: 'Yeah, Nah!',
    subtitle: 'Just Say No',
    description: 'Block an action against you, or counter another block.',
    value: 4,
    count: 3,
  },
  house: {
    name: 'Holiday Shack',
    subtitle: 'House',
    description: 'Add to a complete coastal colour set for +3M rent.',
    value: 3,
    count: 3,
  },
  hotel: {
    name: 'Coastal Resort',
    subtitle: 'Hotel',
    description: 'Add after a shack for another +4M rent.',
    value: 4,
    count: 2,
  },
};
const deck: Card[] = [];
const add = (card: Omit<Card, 'id'>, count = 1) => {
  for (let i = 0; i < count; i++)
    deck.push({ ...card, id: `c${String(deck.length + 1).padStart(3, '0')}` });
};
for (const color of COLORS)
  for (const name of SETS[color].places)
    add({
      kind: 'property',
      name,
      subtitle: SETS[color].name,
      description: 'A little piece of the South Coast. Collect its colour set.',
      value: SETS[color].value,
      colors: [color],
      motif: 'coast',
    });
const pairs: [Color[], number, number][] = [
  [['brown', 'lightBlue'], 1, 1],
  [['lightBlue', 'hardware'], 4, 1],
  [['pink', 'orange'], 2, 2],
  [['red', 'yellow'], 3, 2],
  [['green', 'darkBlue'], 4, 1],
  [['green', 'hardware'], 4, 1],
  [['hardware', 'utility'], 2, 1],
  [COLORS, 0, 2],
];
for (const [colors, value, count] of pairs)
  add(
    {
      kind: 'wild',
      name: colors.length === 10 ? 'Anywhere on the Coast' : 'Coastal Connections',
      subtitle: 'Property Wildcard',
      description: 'Choose a colour when played. Rearrange on your turn without using a play.',
      value,
      colors,
      motif: 'coast',
    },
    count,
  );
for (const [value, count] of [
  [1, 6],
  [2, 5],
  [3, 3],
  [4, 3],
  [5, 2],
  [10, 1],
])
  add(
    {
      kind: 'money',
      name: `${value}M`,
      subtitle: 'South Coast savings',
      description: 'Bank this card to pay your way along the coast.',
      value,
      motif: 'coast',
    },
    count,
  );
for (const [effect, a] of Object.entries(ACTIONS))
  add(
    {
      kind: 'action',
      name: a.name,
      subtitle: a.subtitle,
      description: a.description,
      value: a.value,
      effect: effect as Effect,
      motif: effect === 'draw2' || effect === 'no' ? 'knowledge' : 'notice',
    },
    a.count,
  );
for (const colors of [
  ['brown', 'lightBlue'],
  ['pink', 'orange'],
  ['red', 'yellow'],
  ['green', 'darkBlue'],
  ['hardware', 'utility'],
] as Color[][])
  add(
    {
      kind: 'rent',
      name: 'Holiday Letting',
      subtitle: 'Rent · all opponents',
      description: 'Charge every opponent rent on one matching property group.',
      value: 1,
      colors,
      effect: 'rent',
      motif: 'notice',
    },
    2,
  );
add(
  {
    kind: 'rent',
    name: 'Holiday Letting',
    subtitle: 'Rent · choose one opponent',
    description: 'Charge one opponent rent on any of your property groups.',
    value: 3,
    colors: COLORS,
    effect: 'rent',
    motif: 'notice',
  },
  3,
);
export const DECK: readonly Card[] = deck;
export const CARDS: Record<string, Card> = Object.fromEntries(deck.map((c) => [c.id, c]));
export const card = (id: string): Card => {
  const c = CARDS[id];
  if (!c) throw new Error('Unknown card.');
  return c;
};
