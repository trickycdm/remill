declare module '*.html' {
  const content: string;
  export default content;
}

/** The framed page's comment bridge, bundled to a classic-script string by the
 *  `remill-frame-bridge` Vite plugin (vite.config.ts, D60). */
declare module 'virtual:frame-bridge' {
  const source: string;
  export default source;
}
