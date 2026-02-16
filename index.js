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
            .map((blob, i) => {
                // Extract language from filename: tt1234567_eng.srt or tt1234567_S1E1_eng.srt
                const name = blob.pathname.replace('.srt', '');
                const parts = name.split('_');
                const lang = parts[parts.length - 1] || 'eng';
                return {
                    id: `mysubs-${i}`,
                    url: blob.url,
                    lang: lang,
                    SubFileName: `[My Subs] ${lang.toUpperCase()}`
                };
            });

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
.search-wrap { position: relative; }
.search-results { position: absolute; top: 100%; left: 0; right: 0; background: #1a1a35; border: 1px solid #333; border-radius: 6px; max-height: 250px; overflow-y: auto; z-index: 10; display: none; }
.search-results.show { display: block; }
.search-result { display: flex; align-items: center; padding: 0.5rem 0.7rem; cursor: pointer; gap: 0.7rem; border-bottom: 1px solid #222; }
.search-result:last-child { border: none; }
.search-result:hover { background: #252545; }
.search-result img { width: 36px; height: 52px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
.search-result .info { flex: 1; min-width: 0; }
.search-result .title { font-size: 0.9rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.search-result .meta { font-size: 0.75rem; opacity: 0.5; }
.selected-title { display: none; align-items: center; gap: 0.7rem; padding: 0.5rem 0.7rem; background: #1a1a35; border: 1px solid #8A5AAB; border-radius: 6px; margin-bottom: 0.8rem; }
.selected-title.show { display: flex; }
.selected-title img { width: 36px; height: 52px; object-fit: cover; border-radius: 4px; }
.selected-title .info { flex: 1; }
.selected-title .title { font-size: 0.9rem; font-weight: 600; }
.selected-title .meta { font-size: 0.75rem; opacity: 0.5; }
.selected-title .clear-btn { background: none; border: none; color: #a78bfa; cursor: pointer; font-size: 1.2rem; padding: 0.2rem 0.5rem; }
.search-loading { padding: 0.8rem; text-align: center; opacity: 0.5; font-size: 0.85rem; }
.install-card { border: 1px solid #8A5AAB; }
.install-url { display: flex; gap: 0.5rem; margin-bottom: 0.8rem; }
.install-url input { flex: 1; margin-bottom: 0; font-size: 0.8rem; }
.install-url button { padding: 0.6rem 1rem; background: #2a2a4a; color: #e0e0e0; border: 1px solid #333; border-radius: 6px; cursor: pointer; font-size: 0.8rem; white-space: nowrap; }
.install-url button:hover { background: #3a3a5a; }
.install-btn { display: block; width: 100%; padding: 0.75rem; background: #8A5AAB; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; text-decoration: none; text-align: center; transition: opacity 0.2s; }
.install-btn:hover { opacity: 0.85; }
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

    <label for="searchInput">Search Title</label>
    <div class="search-wrap">
      <input type="text" id="searchInput" placeholder="Search for a movie or series..." autocomplete="off">
      <div class="search-results" id="searchResults"></div>
    </div>
    <div class="selected-title" id="selectedTitle">
      <img id="selectedPoster" src="" alt="">
      <div class="info">
        <div class="title" id="selectedName"></div>
        <div class="meta" id="selectedMeta"></div>
      </div>
      <button type="button" class="clear-btn" onclick="clearSelection()">&times;</button>
    </div>
    <input type="hidden" id="imdbId" name="imdbId" required>

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

    <label for="lang">Language</label>
    <select id="lang" name="lang">
      <option value="eng">English</option>
      <option value="por">Portuguese</option>
      <option value="spa">Spanish</option>
      <option value="fre">French</option>
      <option value="ger">German</option>
      <option value="ita">Italian</option>
      <option value="dut">Dutch</option>
      <option value="rus">Russian</option>
      <option value="ara">Arabic</option>
      <option value="jpn">Japanese</option>
      <option value="kor">Korean</option>
      <option value="chi">Chinese</option>
      <option value="hin">Hindi</option>
      <option value="tur">Turkish</option>
      <option value="pol">Polish</option>
      <option value="swe">Swedish</option>
      <option value="nor">Norwegian</option>
      <option value="dan">Danish</option>
      <option value="fin">Finnish</option>
      <option value="rum">Romanian</option>
    </select>

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

<div class="card install-card">
  <h2>Install Addon</h2>
  <p style="font-size:0.85rem; opacity:0.7; margin-bottom:0.8rem;">Copy the manifest URL or click install to add to Stremio:</p>
  <div class="install-url">
    <input type="text" id="manifestUrl" readonly>
    <button onclick="copyManifest()">Copy</button>
  </div>
  <a class="install-btn" id="installBtn" href="#">Install to Stremio</a>
</div>

<script>
let contentType = 'movie';
let searchTimeout = null;

function setType(t) {
  contentType = t;
  document.querySelectorAll('.type-toggle button').forEach(b => b.classList.toggle('active', b.dataset.type === t));
  document.getElementById('seriesFields').classList.toggle('show', t === 'series');
  clearSelection();
}

// --- Title Search ---
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim();
  if (q.length < 2) { searchResults.classList.remove('show'); return; }
  searchTimeout = setTimeout(() => searchTitles(q), 350);
});

searchInput.addEventListener('focus', () => {
  if (searchResults.children.length > 0 && !document.getElementById('imdbId').value) {
    searchResults.classList.add('show');
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) searchResults.classList.remove('show');
});

async function searchTitles(query) {
  searchResults.innerHTML = '<div class="search-loading">Searching...</div>';
  searchResults.classList.add('show');

  try {
    const url = 'https://v3-cinemeta.strem.io/catalog/' + contentType + '/top/search=' + encodeURIComponent(query) + '.json';
    const res = await fetch(url);
    const data = await res.json();
    const metas = (data.metas || []).slice(0, 8);

    if (metas.length === 0) {
      searchResults.innerHTML = '<div class="search-loading">No results found</div>';
      return;
    }

    searchResults.innerHTML = '';
    metas.forEach(m => {
      const div = document.createElement('div');
      div.className = 'search-result';
      const year = m.releaseInfo || m.year || '';
      div.innerHTML = '<img src="' + (m.poster || '') + '" alt="" onerror="this.style.display=\\'none\\'">'
        + '<div class="info"><div class="title">' + (m.name || '') + '</div>'
        + '<div class="meta">' + year + ' &middot; ' + m.id + '</div></div>';
      div.onclick = () => selectTitle(m);
      searchResults.appendChild(div);
    });
  } catch (err) {
    searchResults.innerHTML = '<div class="search-loading">Search failed</div>';
  }
}

function selectTitle(m) {
  document.getElementById('imdbId').value = m.id;
  document.getElementById('selectedName').textContent = m.name || '';
  document.getElementById('selectedMeta').textContent = (m.releaseInfo || m.year || '') + ' \\u00b7 ' + m.id;
  document.getElementById('selectedPoster').src = m.poster || '';
  document.getElementById('selectedTitle').classList.add('show');
  searchInput.style.display = 'none';
  searchResults.classList.remove('show');

  // Auto-detect type from result
  if (m.type === 'series' && contentType !== 'series') setType('series');
  else if (m.type === 'movie' && contentType !== 'movie') setType('movie');
}

function clearSelection() {
  document.getElementById('imdbId').value = '';
  document.getElementById('selectedTitle').classList.remove('show');
  searchInput.style.display = '';
  searchInput.value = '';
  searchInput.focus();
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
  fd.append('lang', document.getElementById('lang').value);
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

// --- Install Link ---
const manifestPath = location.origin + '/manifest.json';
document.getElementById('manifestUrl').value = manifestPath;
document.getElementById('installBtn').href = 'stremio://' + location.host + '/manifest.json';

function copyManifest() {
  navigator.clipboard.writeText(manifestPath).then(() => {
    const btn = document.querySelector('.install-url button');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}
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
        const { imdbId, type, season, episode, lang } = req.body;
        const language = lang || 'eng';

        if (!imdbId || !/^tt\d+$/.test(imdbId)) {
            return res.status(400).json({ error: 'Invalid IMDB ID. Must be like tt1234567.' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No subtitle file provided.' });
        }

        // Build filename with language code
        let filename;
        if (type === 'series') {
            if (!season || !episode) {
                return res.status(400).json({ error: 'Season and episode required for series.' });
            }
            filename = `${imdbId}_S${season}E${episode}_${language}.srt`;
        } else {
            filename = `${imdbId}_${language}.srt`;
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
