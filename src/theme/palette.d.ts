declare const paletteModule: {
  palette: Record<'light' | 'dark', Record<string, string>>;
  colorNames: string[];
  hexToRgbChannels(hex: string): string;
};

export default paletteModule;
