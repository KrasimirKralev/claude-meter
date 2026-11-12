import type { MapStyleId } from '../doc/types.ts';

export interface MapStyle {
  id: MapStyleId;
  name: string;
  titleFont: string;
  bodyFont: string;
  titleWeight: number;
  bodyWeight: number;
  titleSize: number;
  radius: number;
  itemRadius: number;
  /** Colours of the five bubble slots. */
  colors: [string, string, string, string, string];
  itemBg: string;
  itemInk: string;
  swatches: string[];
  /** Whether these fonts draw Bulgarian letter shapes differently when asked. Measured per font. */
  hasLetterSwitch: boolean;
  /** Loads this style's font files. */
  load: () => Promise<unknown>;
}

const CANDY_COLORS: MapStyle['colors'] = ['#FFE14D', '#FF8CC6', '#6FE3E1', '#FFB27A', '#A9B8FF'];
const SUNNY_COLORS: MapStyle['colors'] = ['#FFD21F', '#FF7A59', '#4CC9F0', '#3DDC97', '#C4A7FF'];

export const MAP_STYLES: Record<MapStyleId, MapStyle> = {
  candy: {
    id: 'candy',
    name: 'Candy',
    titleFont: 'Comfortaa',
    bodyFont: 'Nunito',
    titleWeight: 700,
    bodyWeight: 600,
    titleSize: 24,
    radius: 40,
    itemRadius: 22,
    colors: CANDY_COLORS,
    itemBg: 'rgba(255,255,255,0.72)',
    itemInk: '#14151A',
    swatches: CANDY_COLORS,
    hasLetterSwitch: false,
    load: () =>
      Promise.all([
        import('@fontsource/comfortaa/latin-700.css'),
        import('@fontsource/comfortaa/cyrillic-700.css'),
        import('@fontsource/nunito/latin-600.css'),
        import('@fontsource/nunito/cyrillic-600.css'),
      ]),
  },
  sunny: {
    id: 'sunny',
    name: 'Sunny',
    titleFont: 'Unbounded',
    bodyFont: 'Golos Text',
    titleWeight: 700,
    bodyWeight: 500,
    titleSize: 21,
    radius: 28,
    itemRadius: 14,
    colors: SUNNY_COLORS,
    itemBg: 'rgba(255,255,255,0.62)',
    itemInk: '#14151A',
    swatches: SUNNY_COLORS,
    hasLetterSwitch: true,
    load: () =>
      Promise.all([
        import('@fontsource/unbounded/latin-700.css'),
        import('@fontsource/unbounded/cyrillic-700.css'),
        import('@fontsource/golos-text/latin-500.css'),
        import('@fontsource/golos-text/cyrillic-500.css'),
      ]),
  },
  yellow: {
    id: 'yellow',
    name: 'All yellow',
    titleFont: 'Dela Gothic One',
    bodyFont: 'Rubik',
    titleWeight: 400,
    bodyWeight: 500,
    titleSize: 22,
    radius: 24,
    itemRadius: 12,
    colors: ['#FFD21F', '#FFD21F', '#FFD21F', '#FFD21F', '#FFD21F'],
    itemBg: '#14151A',
    itemInk: '#FFFFFF',
    swatches: ['#FFD21F', '#14151A'],
    hasLetterSwitch: true,
    load: () =>
      Promise.all([
        import('@fontsource/dela-gothic-one/latin-400.css'),
        import('@fontsource/dela-gothic-one/cyrillic-400.css'),
        import('@fontsource/rubik/latin-500.css'),
        import('@fontsource/rubik/cyrillic-500.css'),
      ]),
  },
};

export const BUBBLE_INK = '#14151A';
