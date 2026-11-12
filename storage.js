// Firebase Storage: uploading and deleting, and making smaller versions of photos.

import { app } from "./firebase.js";
import { getStorage, ref, uploadBytesResumable, deleteObject, getBlob }
    from "https://www.gstatic.com/firebasejs/13.2.0/firebase-storage.js";

const storage = getStorage(app);
const blobUrls = new Map(); // path -> promise of a local "blob:" link, so each file is downloaded once per visit

// Downloads a file through the SDK (so the Storage rules apply; there are no public links)
// and returns a temporary local link that <img>, <video>, <iframe> and downloads can use.
export function blobUrl(path) {
    if (!blobUrls.has(path)) {
        const promise = getBlob(ref(storage, path)).then((blob) => URL.createObjectURL(blob));
        promise.catch(() => blobUrls.delete(path)); // a failed download may be tried again later
        blobUrls.set(path, promise);
    }
    return blobUrls.get(path);
}

// Saves a stored file to the user's computer under the given name
export async function downloadFile(path, name) {
    const a = document.createElement("a");
    a.href = await blobUrl(path);
    a.download = name;
    a.click();
}

export const MAX_FILE_SIZE = 100 * 1024 * 1024; // the Storage rules allow just under this

// onProgress(bytesSentSoFar) is called while uploading
export function uploadBlob(path, blob, onProgress) {
    return new Promise((resolve, reject) => {
        const task = uploadBytesResumable(ref(storage, path), blob, {
            contentType: blob.type || "application/octet-stream",
        });
        task.on("state_changed", (snap) => onProgress?.(snap.bytesTransferred), reject, resolve);
    });
}

// Deletes what it can; a path that's already gone is fine
export async function deletePaths(paths) {
    await Promise.all(paths.map((p) => deleteObject(ref(storage, p)).catch(() => { })));
    paths.forEach((p) => blobUrls.delete(p));
}

// For photos the browser can read: { display, thumb } as WebP blobs, or null when it can't read it
// (e.g. HEIC in most browsers). The original is never changed.
export async function photoVersions(file) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(file); // also turns the photo upright if the camera stored it sideways
    } catch {
        return null;
    }
    try {
        return {
            display: await shrink(bitmap, 2000, 0.85),
            thumb: await shrink(bitmap, 300, 0.8),
        };
    } finally {
        bitmap.close();
    }
}

// Scales down (never up) so the longest side is at most `max` pixels
function shrink(bitmap, max, quality) {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

// A tiny square profile photo (cropped from the middle) as text, to store in the person document.
// Small enough (~3 KB) for the tree to show every avatar without downloading anything.
export async function makeAvatar(imageUrl, size = 80) {
    const bitmap = await createImageBitmap(await (await fetch(imageUrl)).blob());
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    canvas.getContext("2d").drawImage(bitmap,
        (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, // the middle square of the photo
        0, 0, size, size);
    bitmap.close();
    return canvas.toDataURL("image/webp", 0.8); // "data:image/webp;base64,..."
}
