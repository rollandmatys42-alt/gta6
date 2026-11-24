# VICEHUB browser-side video cleanup

## Scope
Every authorised download from the public video library, landing page and member dashboard now passes through a browser-side cleanup step. The original private R2 object is never modified. The browser downloads the authorised rendition, removes descriptive container/stream metadata and chapters, keeps video and audio streams with stream copy, verifies the output with MediaInfo and runs a final FFmpeg decode check before creating the client download.

## Supported formats
- MP4
- MOV
- WebM

Unsupported formats fail closed: the original is not silently offered as a fallback.

## Dependencies
- `@ffmpeg/ffmpeg` 0.12.x
- `@ffmpeg/util` 0.12.x
- `mediainfo.js` 0.3.9

The single-thread FFmpeg core is loaded from the official jsDelivr ESM distribution. Multi-thread mode is intentionally not used because it requires cross-origin isolation headers and SharedArrayBuffer.

## Container processing
The command uses stream mapping for real video streams and all audio streams, disables global and per-stream metadata mapping, removes chapter mapping and uses `-c copy`. No video or audio re-encoding is performed. Rotation is explicitly retained when MediaInfo detects it, because removing rotation can change how phone footage is displayed.

The output is checked for video/audio track count, codec identity, duration, residual descriptive tags and chapter/menu tracks. FFmpeg then decodes the output to a null sink; this validates stream readability without creating a second encoded copy.

## Browser constraints
The current browser-processing limit is 300 MB per file. WebAssembly video processing uses browser memory and performance varies by device and browser. The 300 MB limit is deliberate to reduce tab crashes on large files.

## Required R2 CORS configuration
The signed R2 download URL must be readable from the published VICEHUB origin. Configure the bucket CORS policy to allow:
- Allowed origin: `https://gta6-creator-hub-c26cc578.base44.app`
- Allowed methods: `GET`, `HEAD`
- Allowed headers: `*`

If CORS blocks the browser fetch, the download fails closed and the client is told that the bucket policy must be corrected. No server-side video proxy is introduced.

## ExifTool
ExifTool is not bundled into the browser build. It is a native/CLI-oriented complementary fallback, not a browser dependency. For the supported MP4/MOV/WebM path, FFmpeg performs the remux and MediaInfo validates the result. If MediaInfo detects residual descriptive tags, the output is rejected rather than delivered. An ExifTool server fallback is intentionally not activated, to avoid adding server-side video processing costs.

## Production test status
The production Video catalogue was empty at the last audit. The implementation can be built and deployed, but real MP4, MOV and WebM audio/video acceptance tests remain pending until rights-cleared test videos are present and R2 CORS is configured.
