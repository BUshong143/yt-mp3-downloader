const express = require("express");
const cors = require("cors");
const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let ffmpegPath;
try {
  ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
} catch(e) {
  ffmpegPath = "ffmpeg";
}

function getYtDlpCmd() {
  const localBin = path.join(__dirname, "yt-dlp-bin");
  if (fs.existsSync(localBin)) return `"${localBin}"`;
  return "yt-dlp";
}

// Write cookies from env variable to a temp file if available
function getCookiesArg() {
  const cookiesEnv = process.env.YT_COOKIES;
  if (cookiesEnv) {
    const cookiePath = path.join(os.tmpdir(), "yt-cookies.txt");
    fs.writeFileSync(cookiePath, cookiesEnv, "utf8");
    return `--cookies "${cookiePath}"`;
  }
  // Check for local cookies.txt file
  const localCookies = path.join(__dirname, "cookies.txt");
  if (fs.existsSync(localCookies)) {
    return `--cookies "${localCookies}"`;
  }
  return "";
}

function isValidYouTubeUrl(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)/.test(url);
}

function extractVideoId(url) {
  const patterns = [
    /youtu\.be\/([\w-]{11})/,
    /youtube\.com\/watch\?v=([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

app.get("/api/info", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "No URL provided" });
  if (!isValidYouTubeUrl(url)) return res.status(400).json({ error: "Invalid YouTube URL" });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: "Could not extract video ID" });

  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const ytDlp = getYtDlpCmd();
  const cookies = getCookiesArg();
  const cmd = `${ytDlp} --dump-json --no-playlist --no-warnings --no-check-certificate ${cookies} "${cleanUrl}"`;

  console.log("Info cmd:", cmd);

  exec(cmd, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      console.error("yt-dlp error:", stderr || err.message);
      return res.status(500).json({ error: "Could not fetch video info: " + (stderr || err.message).substring(0, 300) });
    }
    try {
      const info = JSON.parse(stdout);
      res.json({
        title: info.title,
        duration: formatDuration(info.duration || 0),
        author: info.uploader || info.channel || "Unknown",
        thumbnail: info.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      });
    } catch (e) {
      res.status(500).json({ error: "Failed to parse video info." });
    }
  });
});

app.get("/api/download", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "No URL provided" });
  if (!isValidYouTubeUrl(url)) return res.status(400).json({ error: "Invalid YouTube URL" });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: "Could not extract video ID" });

  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const ytDlp = getYtDlpCmd();
  const cookies = getCookiesArg();
  const tmpFile = path.join(os.tmpdir(), `audio_${videoId}_${Date.now()}`);

  exec(`${ytDlp} --get-title --no-playlist --no-warnings --no-check-certificate ${cookies} "${cleanUrl}"`,
    { timeout: 30000 },
    (err, stdout) => {
      const title = (stdout || "audio").trim();
      const safeTitle = title.replace(/[^\w\s-]/gi, "").trim().replace(/\s+/g, "_") || "audio";
      const outFile = `${tmpFile}.mp3`;

      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.mp3"`);
      res.setHeader("Content-Type", "audio/mpeg");

      const cmd = `${ytDlp} -x --audio-format mp3 --audio-quality 128K --ffmpeg-location "${ffmpegPath}" --no-playlist --no-warnings --no-check-certificate ${cookies} -o "${outFile}" "${cleanUrl}"`;
      console.log("Download cmd:", cmd);

      exec(cmd, { timeout: 300000 }, (err2, stdout2, stderr2) => {
        if (err2) {
          console.error("Download error:", stderr2 || err2.message);
          if (!res.headersSent) return res.status(500).json({ error: "Download failed." });
          return;
        }
        const finalPath = fs.existsSync(outFile) ? outFile : `${outFile}.mp3`;
        if (!fs.existsSync(finalPath)) {
          if (!res.headersSent) return res.status(500).json({ error: "Output file not found." });
          return;
        }
        const stream = fs.createReadStream(finalPath);
        stream.pipe(res);
        stream.on("end", () => fs.unlink(finalPath, () => {}));
        stream.on("error", () => {
          if (!res.headersSent) res.status(500).json({ error: "Stream error." });
        });
      });
    }
  );
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  const cookies = getCookiesArg();
  console.log(cookies ? "✅ Cookies: loaded" : "⚠️ Cookies: none (may fail on cloud)");
});
