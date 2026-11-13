// What kind of thing a file or link is. Decides how it's shown later:
// photo / video / audio / pdf in the site itself, website as a link card, other as a download.

const EXTENSIONS = {
    photo: ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg", "heic", "heif", "tif", "tiff"],
    video: ["mp4", "webm", "ogv", "mov", "m4v"],
    audio: ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac"],
    pdf: ["pdf"],
};

export const KIND_NAMES = {
    photo: "Photo",
    video: "Video",
    audio: "Audio",
    pdf: "PDF document",
    website: "Website",
    other: "File",
};

// Shown where there's no thumbnail, and on the card for files without a preview
export const KIND_ICONS = { photo: "🖼️", video: "🎬", audio: "🎵", pdf: "📄", website: "🌐", other: "📎" };

// "Scan Opa.JPG" -> "jpg"
export function extensionOf(name) {
    const match = /\.([a-z0-9]+)$/i.exec(name);
    return match ? match[1].toLowerCase() : "";
}

function kindFromExtension(ext) {
    return Object.keys(EXTENSIONS).find((kind) => EXTENSIONS[kind].includes(ext)) ?? null;
}

// The browser's own file type comes first (e.g. "image/jpeg"), the extension as a backup
export function kindFromFile(file) {
    const type = file.type;
    if (type.startsWith("image/")) return "photo";
    if (type.startsWith("video/")) return "video";
    if (type.startsWith("audio/")) return "audio";
    if (type === "application/pdf") return "pdf";
    return kindFromExtension(extensionOf(file.name)) ?? "other";
}

// The 11-character id of a YouTube video, or null. Handles youtube.com/watch?v=, youtu.be/ and /shorts/.
export function youTubeId(url) {
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\.|^m\./, "");
        if (host === "youtu.be") return u.pathname.slice(1, 12) || null;
        if (host === "youtube.com" || host === "youtube-nocookie.com") {
            if (u.searchParams.get("v")) return u.searchParams.get("v");
            const m = /^\/(shorts|embed)\/([\w-]{11})/.exec(u.pathname);
            if (m) return m[2];
        }
    } catch { }
    return null;
}

// Returns the kind, or null when it isn't a valid http(s) link
export function kindFromUrl(url) {
    let u;
    try {
        u = new URL(url);
    } catch {
        return null;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (youTubeId(url)) return "video";
    return kindFromExtension(extensionOf(u.pathname)) ?? "website";
}

// 1536 -> "1.5 KB"
export function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
}
