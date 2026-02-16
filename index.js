const { addonBuilder } = require('stremio-addon-sdk');
const { put, list, del } = require('@vercel/blob');
const express = require('express');
const getRouter = require('stremio-addon-sdk/src/getRouter');
const multer = require('multer');

const ADDON_PORT = process.env.PORT || 7000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// --- Stremio Addon ---

const builder = new addonBuilder({
    id: 'com.custom.mysubs',
    version: '1.0.0',
    name: 'My Subs',
    description: 'Serve your own subtitle files to Stremio from anywhere.',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    logo: 'https://www.stremio.com/website/stremio-logo-small.png'
});

builder.defineSubtitlesHandler(async ({ type, id }) => {
    let imdbId = id;
    let season = null;
    let episode = null;

    if (imdbId.includes(':')) {
        const parts = imdbId.split(':');
        imdbId = parts[0];
        if (parts.length >= 3) {
            season = parts[1];
            episode = parts[2];
        }
    }

    if (!imdbId || !imdbId.startsWith('tt')) {
        return { subtitles: [] };
    }

    // Build the blob prefix to search for
    let prefix;
    if (type === 'series' && season && episode) {
        prefix = `${imdbId}_S${season}E${episode}`;
    } else {
        prefix = imdbId;
    }

    try {
        const { blobs } = await list({ prefix });
        const subtitles = blobs
            .filter(blob => blob.pathname.endsWith('.srt'))
            .map((blob, i) => ({
                id: `mysubs-${i}`,
                url: blob.url,
                lang: 'eng',
                SubFileName: blob.pathname
            }));

        console.log(`[MySubs] ${prefix}: found ${subtitles.length} subtitle(s)`);
        return { subtitles };
    } catch (err) {
        console.error(`[MySubs] Error listing blobs for ${prefix}:`, err.message);
        return { subtitles: [] };
    }
});

// --- Express App ---

const addonInterface = builder.getInterface();
const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

// Mount addon routes (manifest, subtitles, etc.)
app.use(getRouter(addonInterface));

// --- Upload Page ---

const UPLOAD_PAGE = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My Subs - Upload</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', Arial, sans-serif; background: #0a0a1a; color: #e0e0e0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 2rem 1rem; }
h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
.subtitle { opacity: 0.6; margin-bottom: 2rem; font-size: 0.9rem; }
.card { background: #16162a; border-radius: 12px; padding: 1.5rem; width: 100%; max-width: 480px; margin-bottom: 1.5rem; }
.card h2 { font-size: 1.1rem; margin-bottom: 1rem; color: #a78bfa; }
label { display: block; font-size: 0.85rem; margin-bottom: 0.3rem; opacity: 0.8; }
input, select { width: 100%; padding: 0.6rem; border: 1px solid #333; border-radius: 6px; background: #0d0d1f; color: #e0e0e0; font-size: 0.95rem; margin-bottom: 0.8rem; }
input:focus, select:focus { outline: none; border-color: #8A5AAB; }
.row { display: flex; gap: 0.8rem; }
.row > div { flex: 1; }
.series-fields { display: none; }
.series-fields.show { display: flex; }
.type-toggle { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.type-toggle button { flex: 1; padding: 0.5rem; border: 1px solid #333; border-radius: 6px; background: #0d0d1f; color: #e0e0e0; cursor: pointer; font-size: 0.9rem; transition: all 0.2s; }
.type-toggle button.active { background: #8A5AAB; border-color: #8A5AAB; color: white; }
.file-drop { border: 2px dashed #333; border-radius: 8px; padding: 2rem; text-align: center; cursor: pointer; transition: border-color 0.2s; margin-bottom: 0.8rem; }
.file-drop:hover, .file-drop.dragover { border-color: #8A5AAB; }
.file-drop input { display: none; }
.file-drop .label { font-size: 0.95rem; opacity: 0.7; }
.file-drop .selected { color: #8A5AAB; font-weight: 600; }
button[type="submit"] { width: 100%; padding: 0.75rem; background: #8A5AAB; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: opacity 0.2s; }
button[type="submit"]:hover { opacity: 0.85; }
button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; }
.msg { padding: 0.75rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem; display: none; }
.msg.success { display: block; background: #0f3d1f; border: 1px solid #2d7a4a; }
.msg.error { display: block; background: #3d0f0f; border: 1px solid #7a2d2d; }
.blob-list { list-style: none; }
.blob-list li { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #222; font-size: 0.85rem; }
.blob-list li:last-child { border: none; }
.blob-list .name { word-break: break-all; flex: 1; }
.blob-list .del-btn { background: #7a2d2d; color: white; border: none; border-radius: 4px; padding: 0.3rem 0.6rem; cursor: pointer; margin-left: 0.5rem; font-size: 0.8rem; flex-shrink: 0; }
.blob-list .del-btn:hover { background: #a33; }
.empty { opacity: 0.5; font-size: 0.85rem; }
a.back { color: #a78bfa; text-decoration: none; font-size: 0.9rem; margin-bottom: 1.5rem; }
</style>
</head>
<body>
<h1>My Subs</h1>
<p class="subtitle">Upload your own subtitles to Stremio</p>

<div id="msgBox" class="msg"></div>

<div class="card">
  <h2>Upload Subtitle</h2>
  <form id="uploadForm" enctype="multipart/form-data">
    <label>Type</label>
    <div class="type-toggle">
      <button type="button" class="active" data-type="movie" onclick="setType('movie')">Movie</button>
      <button type="button" data-type="series" onclick="setType('series')">Series</button>
    </div>

    <label for="imdbId">IMDB ID</label>
    <input type="text" id="imdbId" name="imdbId" placeholder="tt1234567" required pattern="tt\\d+" title="Must start with tt followed by numbers">

    <div class="series-fields row" id="seriesFields">
      <div>
        <label for="season">Season</label>
        <input type="number" id="season" name="season" min="1" placeholder="1">
      </div>
      <div>
        <label for="episode">Episode</label>
        <input type="number" id="episode" name="episode" min="1" placeholder="1">
      </div>
    </div>

    <label>Subtitle File (.srt)</label>
    <div class="file-drop" id="fileDrop" onclick="document.getElementById('file').click()">
      <input type="file" id="file" name="subtitle" accept=".srt" required>
      <div id="fileLabel" class="label">Click or drag an .srt file here</div>
    </div>

    <button type="submit" id="submitBtn">Upload</button>
  </form>
</div>

<div class="card">
  <h2>Uploaded Subtitles</h2>
  <div id="blobListContainer"><p class="empty">Loading...</p></div>
</div>

<a class="back" href="/">Back to Install page</a>

<script>
let contentType = 'movie';

function setType(t) {
  contentType = t;
  document.querySelectorAll('.type-toggle button').forEach(b => b.classList.toggle('active', b.dataset.type === t));
  document.getElementById('seriesFields').classList.toggle('show', t === 'series');
}

// File drop
const fileDrop = document.getElementById('fileDrop');
const fileInput = document.getElementById('file');
const fileLabel = document.getElementById('fileLabel');
fileInput.addEventListener('change', () => {
  fileLabel.className = fileInput.files.length ? 'selected' : 'label';
  fileLabel.textContent = fileInput.files.length ? fileInput.files[0].name : 'Click or drag an .srt file here';
});
fileDrop.addEventListener('dragover', e => { e.preventDefault(); fileDrop.classList.add('dragover'); });
fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('dragover'));
fileDrop.addEventListener('drop', e => {
  e.preventDefault(); fileDrop.classList.remove('dragover');
  if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; fileInput.dispatchEvent(new Event('change')); }
});

function showMsg(text, type) {
  const box = document.getElementById('msgBox');
  box.textContent = text;
  box.className = 'msg ' + type;
  setTimeout(() => box.className = 'msg', 5000);
}

// Upload
document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Uploading...';

  const fd = new FormData();
  fd.append('subtitle', fileInput.files[0]);
  fd.append('imdbId', document.getElementById('imdbId').value.trim());
  fd.append('type', contentType);
  if (contentType === 'series') {
    fd.append('season', document.getElementById('season').value);
    fd.append('episode', document.getElementById('episode').value);
  }

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (res.ok) { showMsg('Uploaded: ' + data.pathname, 'success'); loadBlobs(); }
    else showMsg(data.error || 'Upload failed', 'error');
  } catch (err) { showMsg('Network error: ' + err.message, 'error'); }

  btn.disabled = false; btn.textContent = 'Upload';
});

// List blobs
async function loadBlobs() {
  const container = document.getElementById('blobListContainer');
  try {
    const res = await fetch('/api/list');
    const data = await res.json();
    if (!data.blobs || data.blobs.length === 0) {
      container.innerHTML = '<p class="empty">No subtitles uploaded yet.</p>';
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'blob-list';
    data.blobs.forEach(b => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="name">' + b.pathname + '</span>';
      const btn = document.createElement('button');
      btn.className = 'del-btn'; btn.textContent = 'Delete';
      btn.onclick = async () => {
        if (!confirm('Delete ' + b.pathname + '?')) return;
        const r = await fetch('/api/delete', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ url: b.url }) });
        if (r.ok) { showMsg('Deleted', 'success'); loadBlobs(); }
        else showMsg('Delete failed', 'error');
      };
      li.appendChild(btn);
      ul.appendChild(li);
    });
    container.innerHTML = '';
    container.appendChild(ul);
  } catch (err) { container.innerHTML = '<p class="empty">Failed to load list.</p>'; }
}
loadBlobs();
</script>
</body>
</html>`;

// --- Landing Page ---

const LANDING_PAGE = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My Subs - Stremio Addon</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', Arial, sans-serif; background: #0a0a1a; color: #e0e0e0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; text-align: center; }
h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
.desc { opacity: 0.7; margin-bottom: 2rem; max-width: 400px; }
.buttons { display: flex; flex-direction: column; gap: 0.75rem; width: 100%; max-width: 300px; }
.buttons a, .buttons button { display: block; padding: 0.8rem; border-radius: 8px; font-size: 1rem; font-weight: 600; text-decoration: none; text-align: center; cursor: pointer; border: none; transition: opacity 0.2s; }
.btn-primary { background: #8A5AAB; color: white; }
.btn-secondary { background: #2a2a4a; color: #e0e0e0; }
.btn-primary:hover, .btn-secondary:hover { opacity: 0.85; }
</style>
</head>
<body>
<h1>My Subs</h1>
<p class="desc">Upload your own subtitle files and serve them to Stremio on any device.</p>
<div class="buttons">
  <a class="btn-primary" id="installLink" href="#">Install Addon</a>
  <a class="btn-secondary" href="/upload">Upload Subtitles</a>
</div>
<script>
const manifest = '/manifest.json';
document.getElementById('installLink').href = 'stremio://' + location.host + manifest;
</script>
</body>
</html>`;

// --- Routes ---

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(LANDING_PAGE);
});

app.get('/upload', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(UPLOAD_PAGE);
});

// Upload API
app.post('/api/upload', upload.single('subtitle'), async (req, res) => {
    try {
        const { imdbId, type, season, episode } = req.body;

        if (!imdbId || !/^tt\d+$/.test(imdbId)) {
            return res.status(400).json({ error: 'Invalid IMDB ID. Must be like tt1234567.' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No subtitle file provided.' });
        }

        // Build filename
        let filename;
        if (type === 'series') {
            if (!season || !episode) {
                return res.status(400).json({ error: 'Season and episode required for series.' });
            }
            filename = `${imdbId}_S${season}E${episode}.srt`;
        } else {
            filename = `${imdbId}.srt`;
        }

        const content = req.file.buffer.toString('utf-8');
        const blob = await put(filename, content, {
            access: 'public',
            addRandomSuffix: false,
            contentType: 'text/srt; charset=utf-8'
        });

        console.log(`[MySubs] Uploaded: ${blob.pathname} -> ${blob.url}`);
        res.json({ pathname: blob.pathname, url: blob.url });
    } catch (err) {
        console.error('[MySubs] Upload error:', err.message);
        res.status(500).json({ error: 'Upload failed: ' + err.message });
    }
});

// List API
app.get('/api/list', async (req, res) => {
    try {
        const { blobs } = await list();
        res.json({ blobs: blobs.map(b => ({ pathname: b.pathname, url: b.url })) });
    } catch (err) {
        console.error('[MySubs] List error:', err.message);
        res.status(500).json({ error: 'Failed to list subtitles.' });
    }
});

// Delete API
app.post('/api/delete', express.json(), async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL required.' });
        await del(url);
        console.log(`[MySubs] Deleted: ${url}`);
        res.json({ success: true });
    } catch (err) {
        console.error('[MySubs] Delete error:', err.message);
        res.status(500).json({ error: 'Delete failed: ' + err.message });
    }
});

// Start server
app.listen(ADDON_PORT, () => {
    console.log(`[MySubs] Addon running at http://localhost:${ADDON_PORT}`);
    console.log(`[MySubs] Manifest: http://localhost:${ADDON_PORT}/manifest.json`);
    console.log(`[MySubs] Upload page: http://localhost:${ADDON_PORT}/upload`);
});
