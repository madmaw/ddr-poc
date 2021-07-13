declare class WebAudioFontPlayer {
  constructor();

  readonly loader: WebAudioFontLoader;

  queueWaveTable(
    audioContext: AudioContext,
    target: AudioNode,
    preset: Preset,
    when: number,
    pitch: number,
    duration: number,
    volume?: number,
    slides?: number,
  );
} 

class WebAudioFontLoader {
  decodeAfterLoading(audioContext: AudioContext, name: string);

  startLoad(audioContext: AudioContext, path: string, name: string);

  waitLoad(callback: () => void);

  intrumentInfo: InstrumentInfo[];
}

interface InstrumentInfo {
  title: string,
  url: string,
  variable: string,
}

interface Preset {
  zones: Zone[],
}

interface Zome {
  ahdsr: boolean,
  buffer: any;
}
