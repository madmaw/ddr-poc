import * as disintegrate from 'disintegrate';
import * as posenet from '@tensorflow-models/posenet';
// force the webgl backend to load
import '@tensorflow/tfjs-backend-webgl';
import { buildSkeletonFromPose, compareSkeltons, flipPose, Part, Skeleton } from './skeleton';

disintegrate.init()

type ImageAndPose = {
  image: HTMLImageElement,
  pose: posenet.Pose,
  skeleton: Skeleton | undefined,
};

var C2 = 0+12*2, c2 = 1+12*2, D2 = 2+12*2, d2 = 3+12*2, E2 = 4+12*2, F2 = 5+12*2, f2 = 6+12*2, G2 = 7+12*2, g2 = 8+12*2, A2 = 9+12*2, a2 = 10+12*2, B2 = 11+12*2;
var C3 = 0+12*3, c3 = 1+12*3, D3 = 2+12*3, d3 = 3+12*3, E3 = 4+12*3, F3 = 5+12*3, f3 = 6+12*3, G3 = 7+12*3, g3 = 8+12*3, A3 = 9+12*3, a3 = 10+12*3, B3 = 11+12*3;
var C4 = 0+12*4, c4 = 1+12*4, D4 = 2+12*4, d4 = 3+12*4, E4 = 4+12*4, F4 = 5+12*4, f4 = 6+12*4, G4 = 7+12*4, g4 = 8+12*4, A4 = 9+12*4, a4 = 10+12*4, B4 = 11+12*4;
var C5 = 0+12*5, c5 = 1+12*5, D5 = 2+12*5, d5 = 3+12*5, E5 = 4+12*5, F5 = 5+12*5, f5 = 6+12*5, G5 = 7+12*5, g5 = 8+12*5, A5 = 9+12*5, a5 = 10+12*5, B5 = 11+12*5;
var C6 = 0+12*6, c6 = 1+12*6, D6 = 2+12*6, d6 = 3+12*6, E6 = 4+12*6, F6 = 5+12*6, f6 = 6+12*6, G6 = 7+12*6, g6 = 8+12*6, A6 = 9+12*6, a6 = 10+12*6, B6 = 11+12*6;

const imageURLs = [
  'dab.jpg',
  'dance.jpg',
  'egypt.jpg',
  'chin.jpg',
  'ballerina.jpg',
];

window.onload = () => {
  const startElement = document.getElementById('start');
  const stopElement = document.getElementById('stop');
  const containerElement = document.getElementById('imageContainer') as HTMLElement;
  const imageCanvasElement = document.getElementById('imageCanvas') as HTMLCanvasElement;
  const videoCanvasElement = document.getElementById('videoCanvas') as HTMLCanvasElement;
  const videoElement = document.getElementById('video') as HTMLVideoElement;
  imageCanvasElement.width = imageCanvasElement.offsetWidth;
  imageCanvasElement.height = imageCanvasElement.offsetHeight;
  const imageCtx = imageCanvasElement.getContext('2d')!;
  const videoCtx = videoCanvasElement.getContext('2d')!;
  const player = new WebAudioFontPlayer();
  let ac: AudioContext | undefined;
  let startHandle: number | undefined;;

  let notes: {
    gain: GainNode,
    preset: (section: number, layers: number) => Preset | undefined,
    pitch: number,
    duration: (N: number) => number,
  }[][];
  let imagesAndPoses: ImageAndPose[];
  let net: posenet.PoseNet;

  function stop() {
    clearTimeout(startHandle);
    startHandle = undefined;
  }

  const barLength = 4;
  const barsPerSection = 4;
  const sectionLength = barLength * barsPerSection;

  function drawSkeleton(ctx: CanvasRenderingContext2D, skeleton: Skeleton, scores?: Map<Part, number>) {
    const score = scores?.get(skeleton.value.keypoint.part as Part) || 1;
    ctx.globalAlpha = score;
    ctx.beginPath();
    ctx.arc(skeleton.value.keypoint.position.x, skeleton.value.keypoint.position.y, 3, 0, Math.PI*2);
    ctx.fill();

    //ctx.font = '20px sans-serif';
    // ctx.fillText(
    //     `${Math.floor(skeleton.value.angleRelativeToParent * 180/Math.PI)} ${skeleton.value.keypoint.part}`,
    //     skeleton.value.keypoint.position.x,
    //     skeleton.value.keypoint.position.y,
    // );

  
    for (const child of skeleton.getChildren()) {
      const score = scores?.get(child.value.keypoint.part as Part) || 1;
      ctx.globalAlpha = score;
  
      ctx.beginPath();
      ctx.moveTo(skeleton.value.keypoint.position.x, skeleton.value.keypoint.position.y);
      ctx.lineTo(child.value.keypoint.position.x, child.value.keypoint.position.y);
      ctx.stroke();
      drawSkeleton(ctx, child, scores);
    }
    ctx.globalAlpha = 1;
  }

  function drawPose(ctx: CanvasRenderingContext2D, pose: posenet.Pose) {
    const adjacentKeypoints = posenet.getAdjacentKeyPoints(pose.keypoints, .2);
    pose.keypoints.forEach(point => {
      ctx.beginPath();
      ctx.arc(point.position.x, point.position.y, 3, 0, Math.PI*2);
      ctx.fill();
    });
    adjacentKeypoints.forEach(keypoints => {
      ctx.beginPath();
      keypoints.forEach((keypoint, i) => {
        if (i == 0) {
          ctx.moveTo(keypoint.position.x, keypoint.position.y);
        } else {
          ctx.lineTo(keypoint.position.x, keypoint.position.y);
        }
      });
      ctx.stroke();
    });
  }

  function start() {
    let previousImageAndPose: ImageAndPose | undefined;
    let bpm = 110;
    if (startHandle) {
      console.log('started already');
    } else {
      const nextPiece = (section: number, M: number, startTime: number, beatLen: number, layers: number) => {
        const index = (section * sectionLength) % notes.length;
        const toPlay = notes.slice(index, index + sectionLength);
        for (var n = 0; n < toPlay.length; n++) {
          var beat = toPlay[n];
          for (var i = 0; i < beat.length; i++) {
            if (beat[i]) {
              const preset = beat[i].preset(section, layers);
              if (preset) {
                player.queueWaveTable(ac!, beat[i].gain, preset, startTime + n * beatLen , beat[i].pitch, beat[i].duration(M));
              }
            }
          }
        }
      }

      let previousEndTimeSeconds = ac!.currentTime + 0.1;
      let section = 0;
      let bestScore = 0;
      let layers = 0;

      const nextImage = () => {
        if (bestScore > .75 || !previousImageAndPose) {
          if (layers + 1 < levelMods.length && section%levelMods[layers + 1] === 0) {
            layers++;
          }
          bpm++;

          const imageAndPose = imagesAndPoses[Math.floor(Math.random()*imagesAndPoses.length)];
          if (previousImageAndPose) {
            const disObj = disintegrate.getDisObj(previousImageAndPose.image);
            if (disObj) {
              disintegrate.createSimultaneousParticles(disObj);
            }
            previousImageAndPose.image.hidden = true;
          }
          imageAndPose.image.hidden = false;
          previousImageAndPose = imageAndPose;  
        } else {
          bpm = Math.max(110, bpm - 1);
          layers = Math.max(0, layers - 1);
        }
        bestScore = 0;
      }
    
      const tick = () => {
        const N = barLength * 60 / bpm;
        const pieceLen = N;
        const beatLen = N / 4;
        const noteLen = beatLen / 4;
        nextPiece(section, N, previousEndTimeSeconds, noteLen, layers);
        previousEndTimeSeconds += pieceLen;
        section++;
        setTimeout(nextImage, (previousEndTimeSeconds - ac!.currentTime - beatLen) * 1000)  
        startHandle = setTimeout(tick, (previousEndTimeSeconds - ac!.currentTime - 0.1) * 1000);
      };

      const draw = async () => {
        const N = barLength * 60 / bpm;
        const beatLen = N / 4;
        const beatProgress = 1 - ((previousEndTimeSeconds - ac!.currentTime)%beatLen)/beatLen
        const sectionProgress = 1 - ((previousEndTimeSeconds - ac!.currentTime - beatLen + N)%N)/N;
        const style = `hsl(${sectionProgress*60}, 100%, ${50 + beatProgress * 50}%)`;
        //const style = `red`;
        const lineWidth = sectionProgress * sectionProgress * 5 + beatProgress * beatProgress;
        if (previousImageAndPose) {
          imageCtx.clearRect(0, 0, imageCanvasElement.width, imageCanvasElement.height);
          imageCtx.strokeStyle = style;
          imageCtx.fillStyle = style;
          imageCtx.lineWidth = lineWidth;
          imageCtx.strokeRect(lineWidth/2, lineWidth/2, previousImageAndPose.image.width - lineWidth, previousImageAndPose.image.height - lineWidth);
          //drawPose(imageCtx, previousImageAndPose.pose);
          if (previousImageAndPose.skeleton) {
            drawSkeleton(imageCtx, previousImageAndPose.skeleton);
          }
        }
        const pose = flipPose(await net.estimateSinglePose(videoElement, {
          flipHorizontal: true,
        }));

        videoCtx.strokeStyle = style;
        videoCtx.fillStyle = style;
        videoCtx.lineWidth = lineWidth;
        videoCtx.save();
        videoCtx.translate(videoCanvasElement.width, 0);
        videoCtx.scale(-1, 1);
        videoCtx.drawImage(videoElement, 0, 0);
        videoCtx.restore();
        const skeleton = buildSkeletonFromPose(pose);
        if (skeleton) {
          const scores = new Map<Part, number>();
          if (previousImageAndPose?.skeleton) {
            const score = compareSkeltons(previousImageAndPose.skeleton, skeleton, scores);
            bestScore = Math.max(bestScore, score);
            videoCtx.textAlign = 'center';
            videoCtx.fillStyle = `hsl(${score*120}, 100%, 50%)`;
            videoCtx.font = '120px sans-serif';
            videoCtx.fillText(`${Math.floor(score * 100)}%`, videoCanvasElement.width/2, videoCanvasElement.height/2);
          }
          drawSkeleton(videoCtx, skeleton, scores);
        }

        if (startHandle) {
          requestAnimationFrame(draw);
        }
      };

      tick();      
      nextImage();
      draw();
    }
  }

  startElement?.addEventListener('click', async () => {
    try {
      await Promise.all([initAudio(), initImages(), initCamera()]);
      start();        
    } catch (e) {
      console.log('something bad happened', e);
    }
  });
  stopElement?.addEventListener('click', stop);

  async function initCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(
          'Browser API navigator.mediaDevices.getUserMedia not available');
    }
  
    const width = videoElement.offsetWidth
    const height = videoElement.offsetHeight;
    videoElement.width = width;
    videoElement.height = height;
    videoCanvasElement.width = width;
    videoCanvasElement.height = height;
  
    const stream = await navigator.mediaDevices.getUserMedia({
      'audio': false,
      'video': {
        facingMode: 'user',
        width,
        height,
      },
    });
    videoElement.srcObject = stream;
  
    return new Promise<HTMLVideoElement>((resolve) => {
      videoElement.onloadedmetadata = () => {
        videoElement.play();
        resolve(videoElement);
      };
    });
  }
  
  async function initImages() {
    net = await posenet.load({
      architecture: 'ResNet50',
      inputResolution: {
        width: 300,
        height: 300,
      },
      quantBytes: 2,
      outputStride: 32,
    });

    while(containerElement?.firstChild) {
      containerElement?.removeChild(containerElement?.firstChild);
    }
    const images = imageURLs.map(url => {
      const image = document.createElement('img');
      image.src = url;
      containerElement?.appendChild(image);
      return image;      
    });
    imagesAndPoses = await Promise.all(images.map(image => new Promise<ImageAndPose>((resolve, reject) => {
      image.onload = async () => {
        const containerWidth = containerElement?.offsetWidth || 1;
        const containerHeight = containerElement?.offsetHeight || 1;
        const containerAspectRatio = containerWidth / containerHeight;
        const imageAspectRatio = image.width / image.height;
        let imageWidth: number;
        let imageHeight: number;
        if (imageAspectRatio > containerAspectRatio) {
          imageWidth = containerWidth;
          imageHeight = containerWidth / imageAspectRatio;
        } else {
          imageHeight = containerHeight;
          imageWidth = containerHeight * imageAspectRatio;
        }
        image.width = imageWidth;
        image.height = imageHeight;
        const area = imageWidth * imageHeight;
        image.setAttribute('data-dis-type', 'simultaneous');
        image.setAttribute('data-dis-particle-type', 'ExplodingParticle');
        image.setAttribute('data-dis-reduction-factor', `${Math.floor(area/1000)}`);  

        try {
          const pose = await net.estimateSinglePose(image);
          const skeleton = buildSkeletonFromPose(pose);
          resolve({
            image,
            pose,
            skeleton,
          });  
        } catch (e) {
          reject(e);
        }
      }
      image.onerror = reject;
    })));
    disintegrate.init();
    images.forEach(image => image.hidden = true);
    //console.log(compareSkeltons(imagesAndPoses[0].skeleton!, imagesAndPoses[1].skeleton!));

  }

  const levelMods = [
    1, // 0
    1, // 1
    1, // 2
    1, // 3
    4, // 4
    4, // 5
    4, // 6
    1, // 7
  ];

  async function initAudio() {
    if (notes == null) {
      const audioContext = new AudioContext();
      ac = audioContext;

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
        names.forEach(name => player.loader.decodeAfterLoading(audioContext, name));
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

      notes=[
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
         player.loader.waitLoad(resolve);
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
};
