import * as disintegrate from 'disintegrate';
import * as posenet from '@tensorflow-models/posenet';
// force the webgl backend to load
import '@tensorflow/tfjs-backend-webgl';
import { buildSkeletonFromPose, compareSkeltons, drawSkeleton, exists, flipPose, Part, Skeleton } from './skeleton';
import { DDRController, DDREvent } from './ddr_controller';
import { Subscription } from 'rxjs';

disintegrate.init()

const imageURLs = [
  'dab.jpg',
  'dance.jpg',
  'egypt.jpg',
  'ballerina.jpg',
  'chin.jpg',
  'travolta.jpeg',
  'multiple.jpg',
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
  let imagesWithScale: {
    scale: number,
    image: HTMLImageElement,
  }[];
  let started = false;

  const controller = new DDRController<number>();
  let subscription: Subscription;

  function eventHandler(e: DDREvent<number>) {
    switch (e.type) {
      case 'finished':
        stop();
        break;
      case 'pose-achieved':
        const image = imagesWithScale[e.id];
        if (image) {
          const disObj = disintegrate.getDisObj(image.image);
          if (disObj) {
            disintegrate.createSimultaneousParticles(disObj);
          }  
          // order is important!
          image.image.hidden = true;
        }
        break;
      case 'pose-started':
        {
          const image = imagesWithScale[e.id];
          if (image) {
            image.image.hidden = false;
          }
        }
        break;
      case 'pose-failed':
        break;
    }
  }

  function stop() {
    if (started) {
      started = false;
      controller.stop();
      subscription?.unsubscribe();  
    }
  }

  function start() {

    videoCanvasElement.width = videoElement.offsetWidth;
    videoCanvasElement.height = videoElement.offsetHeight;

    subscription = controller.eventSource.subscribe(eventHandler);
    controller.start(10);
    const draw = async () => {
      const barProgress = controller.barProgress;
      const beatProgress = controller.beatProgress;
      const index = controller.currentId;
      const style = `hsl(${controller.score*120}, 100%, ${40 + beatProgress * 40}%)`;
      //const style = `red`;
      const lineWidth = barProgress * barProgress * 5 + beatProgress * beatProgress;
      if (index != null) {
        const image = imagesWithScale[index];
        imageCtx.clearRect(0, 0, imageCanvasElement.width, imageCanvasElement.height);
        imageCtx.strokeStyle = style;
        imageCtx.fillStyle = style;
        imageCtx.lineWidth = lineWidth;
        imageCtx.strokeRect(
            lineWidth/2,
            lineWidth/2,
            image.image.width - lineWidth,
            image.image.height - lineWidth,
        );
        const skeletons = controller.currentSkeletons!;
        imageCtx.save();
        imageCtx.lineWidth = lineWidth / image.scale;
        imageCtx.scale(image.scale, image.scale);
        skeletons.forEach((skeleton, i) => {
          const bestScore = controller.bestScores.get(i) || 0;
          const style = `hsl(${bestScore*bestScore*120}, 100%, ${40 + beatProgress * 40}%)`;
          imageCtx.strokeStyle = style;
          drawSkeleton(imageCtx, skeleton);
        });
        imageCtx.restore();
      }

      videoCtx.strokeStyle = style;
      videoCtx.fillStyle = style;
      videoCtx.lineWidth = lineWidth;
      videoCtx.save();
      videoCtx.translate(videoCanvasElement.width, 0);
      videoCtx.scale(-1, 1);
      videoCtx.drawImage(videoElement, 0, 0);
      videoCtx.restore();
      controller.videoSkeletons?.forEach(skeleton => {
        drawSkeleton(videoCtx, skeleton);
      });
      if (started) {
        requestAnimationFrame(draw);
      }
    };
    draw();
  }

  startElement?.addEventListener('click', async () => {
    if (started) {
      return;
    }
    started = true;
    try {
      const idsAndUrls = imageURLs.map((url, i) => [i, url] as const);
      await Promise.all([controller.init(videoElement, idsAndUrls), initImages()]);
      start();        
    } catch (e) {
      console.log('something bad happened', e);
      throw e;
    }
  });
  stopElement?.addEventListener('click', stop);

  
  async function initImages() {
    while(containerElement?.firstChild) {
      containerElement?.removeChild(containerElement?.firstChild);
    }
    const images = imageURLs.map(url => {
      const image = document.createElement('img');
      image.src = url;
      containerElement?.appendChild(image);
      return image;      
    });
    imagesWithScale = await Promise.all(images.map(image => new Promise<{
      image: HTMLImageElement,
      scale: number,
    }>((resolve, reject) => {
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
        const scale = imageWidth/image.width;
        image.width = imageWidth;
        image.height = imageHeight;
        const area = imageWidth * imageHeight;
        image.setAttribute('data-dis-type', 'simultaneous');
        image.setAttribute('data-dis-particle-type', 'ExplodingParticle');
        image.setAttribute('data-dis-reduction-factor', `${Math.floor(area/500)}`);  
        resolve({
          image,
          scale,
        });
      }
      image.onerror = reject;
    })));
    disintegrate.init();
    images.forEach(image => image.hidden = true);
  }
};
