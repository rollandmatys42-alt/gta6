from __future__ import annotations

import configparser
import csv
import hashlib
import mimetypes
import os
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config

VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".mpeg", ".mpg", ".wmv", ".3gp"}
CHUNK_SIZE = 32 * 1024 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_client():
    config_path = Path(__file__).with_name("config.ini")
    if not config_path.exists():
        raise RuntimeError("config.ini is missing. Copy config.example.ini to config.ini and enter your R2 credentials.")
    config = configparser.ConfigParser()
    config.read(config_path, encoding="utf-8")
    values = config["r2"]
    required = ["account_id", "access_key_id", "secret_access_key", "bucket"]
    if any(not values.get(key) or values.get(key).startswith("YOUR_") for key in required):
        raise RuntimeError("Complete all R2 settings in config.ini before uploading.")
    client = boto3.client(
        "s3",
        endpoint_url=f"https://{values['account_id']}.r2.cloudflarestorage.com",
        aws_access_key_id=values["access_key_id"],
        aws_secret_access_key=values["secret_access_key"],
        region_name=values.get("region", "auto"),
        config=Config(signature_version="s3v4", retries={"max_attempts": 8, "mode": "standard"}),
    )
    return client, values["bucket"]


class Uploader(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("VICEHUB — Bulk Video Import")
        self.geometry("720x460")
        self.minsize(620, 380)
        self.folder = tk.StringVar()
        self.status = tk.StringVar(value="Select a folder containing finished videos.")
        self.progress = tk.DoubleVar(value=0)
        self.running = False
        self._build()

    def _build(self):
        root = ttk.Frame(self, padding=18)
        root.pack(fill="both", expand=True)
        ttk.Label(root, text="VICEHUB — WINDOWS VIDEO IMPORTER", font=("Segoe UI", 15, "bold")).pack(anchor="w")
        ttk.Label(root, text="Uploads original files to your private R2 bucket. No editing or conversion.").pack(anchor="w", pady=(4, 16))
        row = ttk.Frame(root)
        row.pack(fill="x")
        ttk.Entry(row, textvariable=self.folder).pack(side="left", fill="x", expand=True)
        ttk.Button(row, text="Choose folder", command=self.choose).pack(side="left", padx=(8, 0))
        self.start_button = ttk.Button(root, text="Start upload", command=self.start)
        self.start_button.pack(anchor="w", pady=14)
        ttk.Progressbar(root, variable=self.progress, maximum=100).pack(fill="x")
        ttk.Label(root, textvariable=self.status, wraplength=660).pack(anchor="w", pady=12)
        self.log = tk.Text(root, height=12, state="disabled", wrap="word")
        self.log.pack(fill="both", expand=True)

    def choose(self):
        chosen = filedialog.askdirectory()
        if chosen:
            self.folder.set(chosen)

    def write_log(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def start(self):
        if self.running:
            return
        folder = Path(self.folder.get())
        if not folder.is_dir():
            messagebox.showerror("Folder required", "Choose a valid folder first.")
            return
        self.running = True
        self.start_button.configure(state="disabled")
        threading.Thread(target=self.run_upload, args=(folder,), daemon=True).start()

    def ui(self, callback, *args):
        self.after(0, callback, *args)

    def run_upload(self, folder: Path):
        try:
            client, bucket = load_client()
            files = sorted(p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS)
            if not files:
                raise RuntimeError("No supported video files were found in this folder.")
            transfer = TransferConfig(
                multipart_threshold=64 * 1024 * 1024,
                multipart_chunksize=CHUNK_SIZE,
                max_concurrency=4,
                use_threads=True,
            )
            manifest_path = folder / "migration-manifest.csv"
            rows = []
            for index, path in enumerate(files, 1):
                self.ui(setattr, self.progress, (index - 1) * 100 / len(files))
                self.ui(self.status.set, f"Processing {index}/{len(files)}: {path.name}")
                try:
                    digest = sha256_file(path)
                    key = f"videos/library/{digest[:2]}/{digest}/{path.name}"
                    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                    client.upload_file(
                        str(path), bucket, key,
                        ExtraArgs={"ContentType": content_type, "Metadata": {"sha256": digest}},
                        Config=transfer,
                    )
                    rows.append({
                        "title": path.stem[:180],
                        "original_filename": path.name,
                        "local_path": str(path),
                        "storage_provider": "r2",
                        "storage_bucket": bucket,
                        "storage_key": key,
                        "file_size_bytes": path.stat().st_size,
                        "mime_type": content_type,
                        "sha256": digest,
                        "migration_status": "uploaded",
                        "rights_status": "authorised",
                    })
                    self.ui(self.write_log, f"OK  {path.name}")
                except Exception as exc:
                    rows.append({
                        "title": path.stem[:180], "original_filename": path.name,
                        "local_path": str(path), "migration_status": "error",
                        "error": str(exc)[:500],
                    })
                    self.ui(self.write_log, f"ERROR  {path.name}: {exc}")
                self.ui(setattr, self.progress, index * 100 / len(files))
            fields = sorted({key for row in rows for key in row})
            with manifest_path.open("w", newline="", encoding="utf-8-sig") as stream:
                writer = csv.DictWriter(stream, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            succeeded = sum(row.get("migration_status") == "uploaded" for row in rows)
            self.ui(self.status.set, f"Finished: {succeeded}/{len(files)} uploaded. Manifest: {manifest_path}")
            self.ui(self.write_log, f"Manifest saved: {manifest_path}")
        except Exception as exc:
            self.ui(self.status.set, str(exc))
            self.ui(self.write_log, f"STOPPED: {exc}")
        finally:
            self.running = False
            self.ui(self.start_button.configure, {"state": "normal"})


if __name__ == "__main__":
    Uploader().mainloop()
