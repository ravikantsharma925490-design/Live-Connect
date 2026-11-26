import { TranslationKeys, TranslationDict, EN_DICT, EN_GB_DICT } from './i18n/types';
import { PACKS_SOUTH_ASIA } from './i18n/packsSouthAsia';
import { PACKS_EAST_ASIA_A } from './i18n/packsEastAsiaA';
import { PACKS_EAST_ASIA_B } from './i18n/packsEastAsiaB';
import { PACKS_WEST_EUROPE_A } from './i18n/packsWestEuropeA';
import { PACKS_WEST_EUROPE_B } from './i18n/packsWestEuropeB';
import { PACKS_EAST_EUROPE_A } from './i18n/packsEastEuropeA';
import { PACKS_EAST_EUROPE_B } from './i18n/packsEastEuropeB';
import { PACKS_CENTRAL_ASIA_MENA_A } from './i18n/packsCentralAsiaMenaA';
import { PACKS_CENTRAL_ASIA_MENA_B } from './i18n/packsCentralAsiaMenaB';
import { PACKS_AFRICA_A } from './i18n/packsAfricaA';
import { PACKS_AFRICA_B } from './i18n/packsAfricaB';

export type { TranslationKeys, TranslationDict };

export const TRANSLATIONS: Record<string, TranslationKeys> = {
  en: EN_DICT,
  'en-GB': EN_GB_DICT,
  ...PACKS_SOUTH_ASIA,
  ...PACKS_EAST_ASIA_A,
  ...PACKS_EAST_ASIA_B,
  ...PACKS_WEST_EUROPE_A,
  ...PACKS_WEST_EUROPE_B,
  ...PACKS_EAST_EUROPE_A,
  ...PACKS_EAST_EUROPE_B,
  ...PACKS_CENTRAL_ASIA_MENA_A,
  ...PACKS_CENTRAL_ASIA_MENA_B,
  ...PACKS_AFRICA_A,
  ...PACKS_AFRICA_B,
};
