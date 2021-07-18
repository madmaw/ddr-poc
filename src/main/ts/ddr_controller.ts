import * as posenet from '@tensorflow-models/posenet';
import { Subject } from 'rxjs';
import { buildSkeletonFromPose, compareSkeltons, exists, flipPose, Skeleton } from './skeleton';

const C2 = 0+12*2, c2 = 1+12*2, D2 = 2+12*2, d2 = 3+12*2, E2 = 4+12*2, F2 = 5+12*2, f2 = 6+12*2, G2 = 7+12*2, g2 = 8+12*2, A2 = 9+12*2, a2 = 10+12*2, B2 = 11+12*2;
const C3 = 0+12*3, c3 = 1+12*3, D3 = 2+12*3, d3 = 3+12*3, E3 = 4+12*3, F3 = 5+12*3, f3 = 6+12*3, G3 = 7+12*3, g3 = 8+12*3, A3 = 9+12*3, a3 = 10+12*3, B3 = 11+12*3;
const C4 = 0+12*4, c4 = 1+12*4, D4 = 2+12*4, d4 = 3+12*4, E4 = 4+12*4, F4 = 5+12*4, f4 = 6+12*4, G4 = 7+12*4, g4 = 8+12*4, A4 = 9+12*4, a4 = 10+12*4, B4 = 11+12*4;
const C5 = 0+12*5, c5 = 1+12*5, D5 = 2+12*5, d5 = 3+12*5, E5 = 4+12*5, F5 = 5+12*5, f5 = 6+12*5, G5 = 7+12*5, g5 = 8+12*5, A5 = 9+12*5, a5 = 10+12*5, B5 = 11+12*5;
const C6 = 0+12*6, c6 = 1+12*6, D6 = 2+12*6, d6 = 3+12*6, E6 = 4+12*6, F6 = 5+12*6, f6 = 6+12*6, G6 = 7+12*6, g6 = 8+12*6, A6 = 9+12*6, a6 = 10+12*6, B6 = 11+12*6;

export type DDREvent<T> = {
  type: 'pose-achieved',
  overallScore: number,  
  id: T,
} | {
  type: 'pose-failed',
  overallScore: number,
  id: T,
} | {
  type: 'pose-started',
  id: T,
} | {
  type: 'finished',
};

const MAX_DETECTIONS = 3;
const TARGET_POSE_FPS = 60;
const MINIMUM_SCORE = .75;
const MINIMUM_BPM = 110;
const BAR_LENGTH = 4;
const BARS_PER_SECTION = 4;
const SECTION_LENGTH = BAR_LENGTH * BARS_PER_SECTION;
const LEVEL_MODS = [
  1, // 0
  1, // 1
  1, // 2
  1, // 3
  4, // 4
  4, // 5
  4, // 6
  1, // 7
];


export class DDRController<T> {

  private notes: {
    gain: GainNode,
    preset: (section: number, layers: number) => Preset | undefined,
    pitch: number,
    duration: (N: number) => number,
  }[][] = [];
  private audioContext: AudioContext | undefined;
  private player = new WebAudioFontPlayer();
  private net: posenet.PoseNet | undefined;
  private idsAndSkeletons: readonly (readonly [T, readonly Skeleton[]])[] = [];
  private startHandle: number | undefined;
  private videoElement: HTMLVideoElement | undefined;
  private loops = 1;

  readonly eventSource: Subject<DDREvent<T>> = new Subject();
  bpm: number = MINIMUM_BPM;
  idAndSkeletonIndex: number | null = null;
  section = 0;
  layers = 0;
  bestScores: Map<number, number> = new Map();
  previousEndTimeSeconds = 0;
  videoSkeletons: readonly Skeleton[] | undefined;

  frames = 0;

  private get currentIdAndSkeletons(): readonly [T, readonly Skeleton[]] | undefined {
    if (this.idAndSkeletonIndex != null) {
      return this.idsAndSkeletons[this.idAndSkeletonIndex % this.idsAndSkeletons.length];
    }
  }

  get score() {
    const skeletons = this.currentSkeletons;
    if (skeletons != null) {
      return skeletons.reduce((val, _, i) => {
        const score = this.bestScores.get(i) || 0;
        return Math.min(val, score)
      }, 1);  
    }
    return 0;
  }

  get barProgress() {
    const N = BAR_LENGTH * 60 / this.bpm;
    const beatLen = N / 4;
    return 1 - ((this.previousEndTimeSeconds - this.audioContext!.currentTime - beatLen + N)%N)/N;
  }

  get beatProgress() {
    const N = BAR_LENGTH * 60 / this.bpm;
    const beatLen = N / 4;
    return 1 - ((this.previousEndTimeSeconds - this.audioContext!.currentTime)%beatLen)/beatLen;
  }

  get currentId() {
    const idAndSkeletons = this.currentIdAndSkeletons;
    if (idAndSkeletons != null) {
      return idAndSkeletons[0];
    }
  }

  get currentSkeletons() {
    const idAndSkeletons = this.currentIdAndSkeletons;
    if (idAndSkeletons != null) {
      return idAndSkeletons[1];
    }    
  }

  async init(videoElement: HTMLVideoElement, idsAndUrls: readonly (readonly [T, string])[]) {
    await Promise.all([this.initAudio(), ,this.initPosenet(idsAndUrls), this.initVideo(videoElement)]);
  }

  start(loops: number = 1) {
    if (this.startHandle) {
      console.log('started already');
    } else {
      this.loops = loops;
      this.bpm = MINIMUM_BPM;
      this.section = 0;
      this.layers = 0;
      this.bestScores = new Map();
      this.idAndSkeletonIndex = null;

      const nextPiece = (M: number, startTime: number, beatLen: number) => {
        const index = (this.section * SECTION_LENGTH) % this.notes.length;
        const toPlay = this.notes.slice(index, index + SECTION_LENGTH);
        for (var n = 0; n < toPlay.length; n++) {
          var beat = toPlay[n];
          for (var i = 0; i < beat.length; i++) {
            if (beat[i]) {
              const preset = beat[i].preset(this.section, this.layers);
              if (preset) {
                this.player.queueWaveTable(this.audioContext!, beat[i].gain, preset, startTime + n * beatLen , beat[i].pitch, beat[i].duration(M));
              }
            }
          }
        }
      }

      this.previousEndTimeSeconds = this.audioContext!.currentTime + 0.1;

      const nextImage = () => {
        const score = this.score;
        if (score > MINIMUM_SCORE || this.idAndSkeletonIndex == null) {
          if (this.idAndSkeletonIndex != null) {
            if (this.layers + 1 < LEVEL_MODS.length && this.section%LEVEL_MODS[this.layers + 1] === 0) {
              this.layers++;
            }
            this.bpm++;  

            const previousId = this.currentId!;
            this.eventSource.next({
              type: 'pose-achieved',
              id: previousId,
              overallScore: score,
            });
            this.idAndSkeletonIndex++;
          } else {
            this.idAndSkeletonIndex = 0;
          }

          if (this.idAndSkeletonIndex < this.idsAndSkeletons.length * this.loops) {
            const id = this.currentId!;
            this.eventSource.next({
              type: 'pose-started',
              id,
            });
          } else {
            this.eventSource.next({
              type: 'finished',
            });
          }
        } else {
          this.layers = Math.max(0, this.layers - 1);
          this.bpm = Math.max(110, this.bpm - 1);
        }
        this.bestScores = new Map();
      }
    
      const tick = () => {
        const N = BAR_LENGTH * 60 / this.bpm;
        const pieceLen = N;
        const beatLen = N / 4;
        const noteLen = beatLen / 4;
        nextPiece(N, this.previousEndTimeSeconds, noteLen);
        this.previousEndTimeSeconds += pieceLen;
        this.section++;
        setTimeout(nextImage, (this.previousEndTimeSeconds - this.audioContext!.currentTime - beatLen) * 1000)  
        this.startHandle = setTimeout(tick, (this.previousEndTimeSeconds - this.audioContext!.currentTime - 0.1) * 1000);
      };

      let previousTargetTime = this.audioContext!.currentTime;
      const processVideo = async () => {
        this.frames++;
        const poses = await this.net?.estimateMultiplePoses(this.videoElement!, {
          flipHorizontal: true,
          maxDetections: MAX_DETECTIONS,
        });
        const skeletons = poses
            ?.map(pose => buildSkeletonFromPose(flipPose(pose)))
            .filter(exists);
        this.videoSkeletons = skeletons;
        const comparisonSkeletons = this.currentSkeletons;
        if (skeletons != null && comparisonSkeletons != null) {
          for (let i=0; i<skeletons.length; i++) {
            const skeleton = skeletons[i];
            for (let j=0; j<comparisonSkeletons.length; j++) {
              const comparisonSkeleton = comparisonSkeletons[j];
              const score = compareSkeltons(comparisonSkeleton, skeleton);
              const existingBestScore = this.bestScores.get(j);
              if (existingBestScore == null || existingBestScore < score) {
                this.bestScores.set(j, score);
              }
            }
          }
        }
        if (this.startHandle != null) {
          const time = this.audioContext!.currentTime;
          const remainingSeconds = Math.max(0, 1/TARGET_POSE_FPS - (time - previousTargetTime))
          previousTargetTime = time + remainingSeconds;
          //setTimeout(processVideo, remainingSeconds * 1000);
          requestAnimationFrame(processVideo);
        }
      };

      tick();
      nextImage();
      processVideo();
    }
  }

  stop() {
    clearTimeout(this.startHandle);
    this.startHandle = undefined;
  }

  async initVideo(videoElement: HTMLVideoElement) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(
          'Browser API navigator.mediaDevices.getUserMedia not available',
      );
    }
  
    const width = videoElement.offsetWidth
    const height = videoElement.offsetHeight;
    videoElement.width = width;
    videoElement.height = height;
    
    const stream = await navigator.mediaDevices.getUserMedia({
      'audio': false,
      'video': {
        facingMode: 'user',
        width,
        height,
      },
    });
    videoElement.srcObject = stream;
    this.videoElement = videoElement;
  
    return new Promise<HTMLVideoElement>((resolve, reject) => {
      videoElement.onloadedmetadata = () => {
        videoElement.play();
        resolve(videoElement);
      };
      videoElement.onerror = reject;
    });    
  }

  async initPosenet(idsAndUrls: readonly (readonly [T, string])[]) {
    this.net = await posenet.load({
      architecture: 'ResNet50',
      inputResolution: {
        width: 300,
        height: 300,
      },
      quantBytes: 2,
      outputStride: 32,
    });
    this.idsAndSkeletons = (await Promise.all(idsAndUrls.map(async ([id, url]) => {
      const image = document.createElement('img');
      image.src = url;
      try {
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
        });
        const poses = await this.net?.estimateMultiplePoses(image, {
          flipHorizontal: false,
          maxDetections: MAX_DETECTIONS,
        });
        const skeletons = poses
            // do not reduce this down as the second parameter to SDFP is a number (index in map)
            ?.map(pose => buildSkeletonFromPose(pose))
            .filter(exists);
        if (skeletons != null && skeletons.length > 0) {
          return [id, skeletons] as const;
        }          
      } catch (e) {
        // ignore this image
        console.error(e);
      }
    }))).filter(exists);
  }

  async initAudio() {
    if (this.audioContext == null) {
      const audioContext = new AudioContext();
      this.audioContext = audioContext;

      for(var i=0;i<_tone_0480_Chaos_sf2_file.zones.length;i++){
				_tone_0480_Chaos_sf2_file.zones[i].ahdsr=false;
			}

      const data = [{
        // drum
        names: ['_drum_36_6_JCLive_sf2_file'],
        volume: 0.5,
        presets: [_drum_36_6_JCLive_sf2_file],
        defaultPitch: D3,
        defaultDuration: 1,
        level: 1,
      }, {
        // snare
        names: ['_drum_40_6_JCLive_sf2_file'],
        volume: 0.5,
        presets: [_drum_40_6_JCLive_sf2_file],
        defaultPitch: 38,
        defaultDuration: 1,
        level: 4,
      }, {
        // bass
        names: ['_tone_0390_Aspirin_sf2_file', '_tone_0380_Chaos_sf2_file'],
        volume: 0.7,
        presets: [_tone_0390_Aspirin_sf2_file, _tone_0380_Chaos_sf2_file],
        level: 4,
        presetScale: 12,
      }, {
        // open
        names: ['_drum_46_6_JCLive_sf2_file'],
        volume: 0.7,
        presets: [_drum_46_6_JCLive_sf2_file],
        defaultPitch: 46,
        defaultDuration: 1,
        level: 3,
      }, {
        // hihat
        names: ['_drum_42_6_JCLive_sf2_file'],
        volume: 0.5,
        presets: [_drum_42_6_JCLive_sf2_file],
        defaultPitch: 42,
        defaultDuration: 1,
        level: 3,
      }, {
        // orchestra
        names: ['_tone_0550_Chaos_sf2_file'],
        volume: 0.5,
        presets: [_tone_0550_Chaos_sf2_file],
        level: 5,
      }, {
        // synth
        names: ['_tone_0480_Chaos_sf2_file', '_tone_0520_Aspirin_sf2_file', '_tone_0290_Aspirin_sf2_file'],
        volume: 0.3,
        presets: [_tone_0480_Chaos_sf2_file, _tone_0520_Aspirin_sf2_file, _tone_0290_Aspirin_sf2_file],
        level: 5,
        presetScale: 8,
      }];

      const [
        drum,
        snare,
        bass,
        open,
        hihat,
        orchestra,
        synth,
      ] = data.map(({ names, volume, presets, defaultPitch, defaultDuration, level, presetScale }) => {
        names.forEach(name => this.player.loader.decodeAfterLoading(audioContext, name));
        const gain = audioContext.createGain();
        gain.connect(audioContext.destination);
        gain.gain.value=volume;

        return (pitch?: number, baseDuration?: number) => {
          return {
            gain,
            preset: (currentSection: number, maxLayer: number) => maxLayer >= level
                ? presets[Math.floor(currentSection/(presetScale || 1))%presets.length]
                : undefined,
            pitch: pitch || defaultPitch!,
            duration: (N: number) => baseDuration != null
                ? (baseDuration! * N) 
                : defaultDuration!,
          }
        };
      });

      this.notes = [
      // 
        [hihat(),drum(),        bass(C3,1/16),orchestra(C5,1/4),synth(C3,1/1),synth(C4,1/1),synth(G3,1/1),synth(C5,1/2),synth(d5,3/8)]//1/16
       ,[hihat()                                                                                                                     ]
       ,[open(),                bass(C3,1/16)                                                                                        ]
       ,[                       bass(C3,1/16)                                                                                        ]
       // 
       ,[hihat(),drum(),snare(),bass(C3,1/16)                                                                                        ]
       ,[hihat(),               bass(C3,1/16)                                                                                        ]
       ,[open(),                bass(C3,1/16),                  synth(D5,1/8)                                                        ]
       ,[                       bass(C3,1/16)                                                                                        ]
       //
       ,[hihat(),drum(),        bass(C3,1/16),                  synth(C5,1/8)                                                        ]
       ,[hihat(),               bass(C3,1/16),                  synth(C3,1/1)                                                        ]
       ,[open(),                                                synth(D5,1/8)                                                        ]
       ,[                       bass(C3,1/16)                                                                                        ]
       // 
       ,[hihat(),drum(C3),snare(),bass(C3,1/16),                  synth(d5,1/8)                                                        ]
       ,[hihat(),               bass(C3,1/16)                                                                                        ]
       ,[open(),                bass(C3,1/16),orchestra(G4,1/8),synth(G5,1/8)                                                        ]
       ,[                       bass(C3,1/16)                                                                                        ]
       //
       ,[hihat(),drum(),        bass(G2,1/16),orchestra(a5,1/4),synth(G3,1/1),synth(G4,1/1),synth(D5,3/1),synth(a5,3/8)              ]//16/16
       ,[hihat()                                                                                                                     ]
       ,[open(),                bass(G2,1/16)                                                                                        ]
       ,[                       bass(G2,1/16)                                                                                        ]
       //
       ,[hihat(),drum(),snare(),bass(G2,1/16)                                                                                        ]
       ,[hihat(),               bass(G2,1/16)                                                                                        ]
       ,[open(),                bass(G2,1/16),                  synth(A5,1/8)                                                        ]
       ,[                       bass(G2,1/16)                                                                                        ]
       //
       ,[hihat(),drum(),        bass(G2,1/16),                  synth(G5,1/8)                                                        ]
       ,[hihat(),               bass(G2,1/16)                                                                                        ]
       ,[open(),                bass(G2,1/16),                  synth(A5,1/8)                                                        ]
       ,[                       bass(G2,1/16)                                                                                        ]
       //
       ,[hihat(),drum(C3),snare(),bass(G2,1/16),                  synth(a5,1/8)                                                        ]
       ,[hihat(),               bass(G2,1/16)                                                                                        ]
       ,[open(),                bass(G2,1/16),orchestra(d5,1/8),synth(D6,1/8)                                                        ]
       ,[                       bass(G2,1/16)                                                                                        ]
       //
       ,[hihat(),drum(),        bass(a2,1/16),orchestra(F5,1/1),synth(a3,2/1),synth(a4,2/1),synth(F5,2/1),synth(F6,2/1)              ]//32/16
       ,[hihat()                                                                                                                     ]
       ,[open(),                bass(a2,1/16)                                                                                        ]
       ,[                       bass(a2,1/16)                                                                                        ]
       //
       ,[hihat(),drum(),snare(),bass(a2,1/16)                                                                                        ]
       ,[hihat(),               bass(a2,1/16)                                                                                        ]
       ,[open(),                bass(a2,1/16)                                                                                        ]
       ,[                       bass(a2,1/16)                                                                                        ]
       ,[hihat(),drum(),        bass(a2,1/16)                                                                                        ]
       ,[hihat(),               bass(a2,1/16)                                                                                        ]
       ,[open(),                bass(a2,1/16)                                                                                        ]
       ,[                       bass(a2,1/16)                                                                                        ]
       ,[hihat(),drum(C3),snare(),bass(a2,1/16)                                                                                        ]
       ,[hihat(),               bass(a2,1/16)                                                                                        ]
       ,[open(),                bass(a2,1/16)                                                                                        ]
       ,[                       bass(a2,1/16)                                                                                        ]
       ,[hihat(),drum(),        bass(a2,1/16)                                                                                        ]//48/16
       ,[hihat()                                                                                                                     ]
       ,[open(),                bass(a2,1/16)                                                                                        ]
       ,[                       bass(a2,1/16)                                                                                        ]
       ,[hihat(),drum(),snare(),bass(a2,1/16)                                                                                        ]
       ,[hihat(),               bass(a2,1/16)                                                                                        ]
       ,[open(),                bass(a2,1/16)                                                                                        ]
       ,[                       bass(a2,1/16)                                                                                        ]
       ,[hihat(),drum(),        bass(a2,1/16)                                                                                        ]
       ,[hihat(),               bass(a2,1/16)                                                                                        ]
       ,[open(),                bass(a2,1/16)                                                                                        ]
       ,[                       bass(a2,1/16)                                                                                        ]
       ,[hihat(),drum(C3),snare(),bass(a2,1/16)                                                                                        ]
       ,[hihat(),               bass(a2,1/16)                                                                                        ]
       ,[open(),                bass(a2,1/16)                                                                                        ]
       ,[                       bass(a2,1/16)                                                                                        ]
       ];
       await new Promise<void>(resolve => {
         this.player.loader.waitLoad(resolve);
       });
       // also wait for the buffering to finish on the loaded presets
       await new Promise<void>(resolve => {
        const handle = setInterval(() => {
          if (data.every(({ presets }) => presets.every(preset => preset.zones.every(zone => zone.buffer != null)))) {
            clearInterval(handle);
            resolve();
          }
        }, 100);
       });

    }
  }
}
