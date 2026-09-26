interface PaletteTheme {
  id: string;
  name: string;
  light: Record<string, string>;
  dark: Record<string, string>;
}

declare const paletteModule: {
  themes: [PaletteTheme, ...PaletteTheme[]];
  colorNames: string[];
  hexToRgbChannels(hex: string): string;
};

export default paletteModule;
