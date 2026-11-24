let ffmpegPromise = null;
let processing = false;

const CORE_BASE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
const PRIVATE_METADATA_KEYS = new Set([
  "Title", "Description", "Comment", "Director", "Performer", "Album",
  "Genre", "Recorded_Date", "Encoded_Date", "Tagged_Date", "Copyright",
  "Location", "GPS", "Composer", "Publisher", "Author", "Artist",
  "Album_Performer", "Track", "Track_Position", "URL", "Keywords", "Subject",
]);

async function getFFmpeg() {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/util"),
      ]);
      const ffmpeg = new FFmpeg();
      const coreURL = await toBlobURL(CORE_BASE_URL + "/ffmpeg-core.js", "text/javascript");
      const wasmURL = await toBlobURL(CORE_BASE_URL + "/ffmpeg-core.wasm", "application/wasm");
      await ffmpeg.load({ coreURL, wasmURL });
      return ffmpeg;
    })().catch(error => {
      ffmpegPromise = null;
      throw error;
    });
  }
  return ffmpegPromise;
}

async function inspectWithMediaInfo(blob) {
  const { default: mediaInfoFactory } = await import("mediainfo.js");
  const mediaInfo = await mediaInfoFactory({ format: "object", full: true });
  try {
    return await mediaInfo.analyzeData(blob.size, async (chunkSize, offset) => {
      const buffer = await blob.slice(offset, offset + chunkSize).arrayBuffer();
      return new Uint8Array(buffer);
    });
  } finally {
    mediaInfo.close();
  }
}

function tracksOf(result, type) {
  return (result?.media?.track || []).filter(track => track["@type"] === type);
}

function codecSignature(track) {
  return [track.Format || "", track.CodecID || "", track.Format_Profile || ""].join("|");
}

function assertCompatibleTracks(before, after) {
  const beforeVideo = tracksOf(before, "Video");
  const afterVideo = tracksOf(after, "Video");
  const beforeAudio = tracksOf(before, "Audio");
  const afterAudio = tracksOf(after, "Audio");

  if (!beforeVideo.length || beforeVideo.length !== afterVideo.length) {
    throw new Error("The cleaned file did not retain every video stream.");
  }
  if (beforeAudio.length !== afterAudio.length) {
    throw new Error("The cleaned file did not retain every audio stream.");
  }

  for (let index = 0; index < beforeVideo.length; index += 1) {
    if (codecSignature(beforeVideo[index]) !== codecSignature(afterVideo[index])) {
      throw new Error("The video codec changed during container cleanup. The file was not delivered.");
    }
  }
  for (let index = 0; index < beforeAudio.length; index += 1) {
    if (codecSignature(beforeAudio[index]) !== codecSignature(afterAudio[index])) {
      throw new Error("The audio codec changed during container cleanup. The file was not delivered.");
    }
  }

  const beforeGeneral = tracksOf(before, "General")[0] || {};
  const afterGeneral = tracksOf(after, "General")[0] || {};
  const beforeDuration = Number.parseFloat(beforeGeneral.Duration);
  const afterDuration = Number.parseFloat(afterGeneral.Duration);
  if (Number.isFinite(beforeDuration) && Number.isFinite(afterDuration) &&
      Math.abs(beforeDuration - afterDuration) > 1.5) {
    throw new Error("The cleaned file duration differs from the source.");
  }

  const outputTracks = after?.media?.track || [];
  if (outputTracks.some(track => track["@type"] === "Menu")) {
    throw new Error("Chapter or menu tracks remain in the cleaned file.");
  }

  const residual = outputTracks.flatMap(track =>
    Array.from(PRIVATE_METADATA_KEYS).filter(key =>
      track[key] !== undefined && track[key] !== null && String(track[key]).trim() !== ""
    )
  );
  if (residual.length) {
    throw new Error("Some descriptive metadata remains. The file was not delivered.");
  }
}

export async function cleanVideoBlob(sourceBlob, extension, onProgress = () => {}) {
  if (processing) throw new Error("Another video is already being cleaned. Wait for it to finish.");
  if (!["mp4", "mov", "webm"].includes(extension)) {
    throw new Error("Only MP4, MOV and WebM files can be cleaned automatically.");
  }
  if (!sourceBlob || !sourceBlob.size) throw new Error("The source video is empty.");
  if (sourceBlob.size > 300 * 1024 * 1024) {
    throw new Error("This video is larger than the current 300 MB browser-processing limit.");
  }

  processing = true;
  let inputName = "";
  let outputName = "";
  let ffmpeg = null;
  try {
    onProgress("Checking the original video and its audio tracks…");
    const before = await inspectWithMediaInfo(sourceBlob);
    const sourceVideoTracks = tracksOf(before, "Video");
    if (!sourceVideoTracks.length) throw new Error("No video stream was detected in this file.");

    onProgress("Loading the browser video-cleaning engine…");
    ffmpeg = await getFFmpeg();
    const id = Date.now().toString(36);
    inputName = "vicehub-source-" + id + "." + extension;
    outputName = "vicehub-clean-" + id + "." + extension;
    await ffmpeg.writeFile(inputName, new Uint8Array(await sourceBlob.arrayBuffer()));

    const args = [
      "-hide_banner", "-y", "-i", inputName,
      "-map", "0:V?", "-map", "0:a?",
      "-map_metadata", "-1",
      "-map_metadata:s", "-1",
      "-map_chapters", "-1",
      "-c", "copy",
    ];

    // Rotation is the one display-critical stream property that must survive metadata removal.
    sourceVideoTracks.forEach((track, index) => {
      const rotation = Number.parseFloat(track.Rotation);
      if (Number.isFinite(rotation) && rotation !== 0) {
        args.push("-metadata:s:v:" + index, "rotate=" + String(rotation));
      }
    });

    if (extension === "mp4") args.push("-movflags", "+faststart");
    args.push(outputName);

    onProgress("Removing descriptive metadata and unnecessary tracks without re-encoding…");
    const progressHandler = ({ progress }) => {
      if (Number.isFinite(progress)) {
        const percent = Math.max(0, Math.min(99, Math.round(progress * 100)));
        onProgress("Cleaning the container… " + percent + "%");
      }
    };
    ffmpeg.on("progress", progressHandler);
    try {
      const exitCode = await ffmpeg.exec(args);
      if (exitCode !== 0) throw new Error("FFmpeg could not clean this video container.");
    } finally {
      ffmpeg.off("progress", progressHandler);
    }

    onProgress("Checking video, audio, codecs and remaining metadata…");
    const outputBytes = await ffmpeg.readFile(outputName);
    if (!outputBytes?.length) throw new Error("FFmpeg produced an empty output file.");
    const mimeType = extension === "mp4" ? "video/mp4" : extension === "mov" ? "video/quicktime" : "video/webm";
    const cleanedBlob = new Blob([outputBytes], { type: mimeType });
    const after = await inspectWithMediaInfo(cleanedBlob);
    assertCompatibleTracks(before, after);

    onProgress("Running the final audio/video integrity check…");
    const verifyCode = await ffmpeg.exec([
      "-hide_banner", "-v", "error", "-i", outputName,
      "-map", "0:V?", "-map", "0:a?", "-f", "null", "-",
    ]);
    if (verifyCode !== 0) throw new Error("The final audio/video integrity check failed. The file was not delivered.");

    onProgress("Clean video verified. Preparing your download…");
    return { blob: cleanedBlob, extension, mimeType };
  } finally {
    if (ffmpeg) {
      if (inputName) await ffmpeg.deleteFile(inputName).catch(() => {});
      if (outputName) await ffmpeg.deleteFile(outputName).catch(() => {});
    }
    processing = false;
  }
}
