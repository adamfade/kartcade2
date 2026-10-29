// Vite asset imports used by the track builder (a file's URL after bundling).
declare module '*?url' {
    const url: string;
    export default url;
}
