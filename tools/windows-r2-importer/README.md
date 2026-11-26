# VICEHUB Windows bulk uploader

A small Windows desktop utility to transfer finished video files from a local disk to a private Cloudflare R2 bucket. It does not edit, transcode, split, or publish videos.

## Setup
1. Install Python 3.11+ on Windows.
2. Copy `config.example.ini` to `config.ini` and enter an R2 S3 API token restricted to the target bucket. Never commit `config.ini`.
3. Run `install.bat`, then `start.bat`.
4. Select a folder and start the transfer. The tool scans subfolders, skips non-video files, hashes each video, uploads with multipart support, and writes `migration-manifest.csv` beside the selected folder.

The manifest is an inventory/transfer report. It does not publish videos or create Base44 catalogue records. Keep the source files until the VICEHUB player and download access have been tested against the R2 objects.

Supported extensions: mp4, mov, m4v, webm, mkv, avi, mpeg, mpg, wmv, 3gp. No format conversion is performed. Browser playback depends on the original codec/container; MP4 H.264/AAC is recommended.

## Security
- Use a dedicated R2 token with Object Read & Write only for the target bucket.
- Keep `config.ini` private and do not send it by email or commit it to Git.
- Upload keys are deterministic by SHA-256, so identical content is deduplicated by object key.
- This tool uploads files only. It does not expose public bucket URLs.
