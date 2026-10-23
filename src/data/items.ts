import type { ItemDef } from './types';

export const ITEMS: ItemDef[] = [
  {
    id: 'heart',
    name: 'Heart',
    description: 'Raises max HP by 20.',
    icon: 'icon_heart',
    perLevel: [{ stat: 'maxHp', flat: 20 }],
    levelText: '+20 max HP.',
  },
  {
    id: 'boots',
    name: 'Boots',
    description: 'Move 10% faster.',
    icon: 'icon_boots',
    perLevel: [{ stat: 'moveSpeed', percent: 0.1 }],
    levelText: '+10% move speed.',
  },
  {
    id: 'magnet',
    name: 'Magnet',
    description: 'EXP gems fly to you from 30% further away.',
    icon: 'icon_magnet',
    perLevel: [{ stat: 'pickupRadius', percent: 0.3 }],
    levelText: '+30% pickup radius.',
  },
  {
    id: 'tome',
    name: 'Tome',
    description: 'Weapons recharge 8% faster.',
    icon: 'icon_tome',
    perLevel: [{ stat: 'cooldownMult', percent: -0.08 }],
    levelText: '-8% cooldown.',
  },
];
