
type Disintegrate = {
}

type DisObj = {
  elem: HTMLElement;
  kill(): void;
}

type DisELem = {
  elem: HTMLElement,
  data: {
    disType: string,
    disParticleType: string,
    disReductionFactor?: number,
  }
}

declare module 'disintegrate' {
  export function init(arr?: DisElem[]): void;
  export function getDisObj(e: Node): DisObj;
  export function createSimultaneousParticles(o: DisObj): void;
};
