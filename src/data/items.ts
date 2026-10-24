import type { ItemDef } from './types';

/** Items: stat boosts that take an item slot. Plain stat boosts without a slot are generic powerups (powerups.ts). */
export const ITEMS: ItemDef[] = [
  {
    id: 'magnet',
    name: 'Magnet',
    description: 'EXP gems fly to you from 30% further away.',
    icon: 'icon_magnet',
    perLevel: [{ stat: 'pickupRadius', percent: 0.3 }],
    levelText: '+30% pickup radius.',
  },
];
