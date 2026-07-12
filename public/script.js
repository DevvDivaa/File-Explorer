let currentPath = '';
let historyStack = [];
let currentItems = [];

const fileListEl = document.getElementById('fileList');
const emptyStateEl = document.getElementById('emptyState');
const breadcrumbEl = document.getElementById('breadcrumb');
const searchBox = document.getElementById('searchBox');

async function apiList(p) {
  const res = await fetch(`/api/list?path=${encodeURIComponent(p)}`);
  return res.json();
}
async function apiMkdir(p, name) {
  const res = await fetch('/api/mkdir', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p, name }),
  });
  return res.json();
}
async function apiDelete(p) {
  const res = await fetch('/api/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p }),
  });
  return res.json();
}
async function apiRename(p, newName) {
  const res = await fetch('/api/rename', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p, newName }),
  });
  return res.json();
}

function formatSize(bytes) {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(val < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function joinPath(base, name) {
  return base ? `${base}/${name}` : name;
}
function showToast(message, type = 'success') {
  const toastEl = document.getElementById('nfToast');
  document.getElementById('nfToastBody').textContent = message;
  toastEl.classList.remove('bg-success', 'bg-danger');
  toastEl.classList.add(type === 'success' ? 'bg-success' : 'bg-danger');
  new bootstrap.Toast(toastEl, { delay: 2500 }).show();
}

function renderBreadcrumb() {
  const parts = currentPath ? currentPath.split('/') : [];
  let acc = '';
  let html = `<li class="breadcrumb-item"><a data-path="">Home</a></li>`;
  parts.forEach((part) => {
    acc = joinPath(acc, part);
    html += `<li class="breadcrumb-item"><a data-path="${acc}">${part}</a></li>`;
  });
  breadcrumbEl.innerHTML = html;
  const lastItem = breadcrumbEl.lastElementChild;
  if (lastItem) {
    lastItem.classList.add('active');
    lastItem.innerHTML = lastItem.querySelector('a').textContent;
  }
  breadcrumbEl.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => navigateTo(a.dataset.path, true));
  });
}

function renderList(items) {
  fileListEl.innerHTML = '';
  emptyStateEl.classList.toggle('d-none', items.length > 0);

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = `nf-row ${item.isDirectory ? 'is-folder' : 'is-file'}`;
    const icon = item.isDirectory
      ? '<i class="bi bi-folder-fill folder-icon"></i>'
      : '<i class="bi bi-file-earmark-text file-icon"></i>';

    row.innerHTML = `
      <span class="col-name">
        ${icon}
        <span class="name-text" title="${item.name}">${item.name}</span>
      </span>
      <span class="col-size">${item.isDirectory ? '—' : formatSize(item.size)}</span>
      <span class="col-modified">${formatDate(item.modified)}</span>
      <span class="col-actions">
        ${!item.isDirectory ? `<button class="nf-action-btn" data-action="download" title="Download"><i class="bi bi-download"></i></button>` : ''}
        <button class="nf-action-btn" data-action="rename" title="Rename"><i class="bi bi-pencil"></i></button>
        <button class="nf-action-btn danger" data-action="delete" title="Delete"><i class="bi bi-trash"></i></button>
      </span>
    `;

    const fullPath = joinPath(currentPath, item.name);

    if (item.isDirectory) {
      row.querySelector('.name-text').addEventListener('click', () => navigateTo(fullPath));
    }
    row.querySelector('[data-action="rename"]').addEventListener('click', () => openRenameModal(fullPath, item.name));
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteItem(fullPath, item.name));
    const dlBtn = row.querySelector('[data-action="download"]');
    if (dlBtn) dlBtn.addEventListener('click', () => {
      window.location.href = `/api/download?path=${encodeURIComponent(fullPath)}`;
    });

    fileListEl.appendChild(row);
  });
}

async function navigateTo(p, skipHistory) {
  if (!skipHistory) historyStack.push(currentPath);
  currentPath = p;
  await refresh();
}

async function refresh() {
  const data = await apiList(currentPath);
  if (data.error) { showToast(data.error, 'danger'); return; }
  currentItems = data.items;
  renderBreadcrumb();
  applyFilter();
  document.querySelectorAll('.nf-nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.goto === currentPath);
  });
}

function applyFilter() {
  const term = searchBox.value.trim().toLowerCase();
  const filtered = term ? currentItems.filter((i) => i.name.toLowerCase().includes(term)) : currentItems;
  renderList(filtered);
}

async function deleteItem(fullPath, name) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  const res = await apiDelete(fullPath);
  if (res.error) return showToast(res.error, 'danger');
  showToast(`"${name}" deleted`);
  refresh();
}

let renameTargetPath = '';
function openRenameModal(fullPath, currentName) {
  renameTargetPath = fullPath;
  document.getElementById('renameInput').value = currentName;
  new bootstrap.Modal(document.getElementById('modalRename')).show();
}

document.getElementById('btnUp').addEventListener('click', () => {
  if (!currentPath) return;
  const parts = currentPath.split('/');
  parts.pop();
  navigateTo(parts.join('/'));
});

document.getElementById('btnBack').addEventListener('click', () => {
  if (historyStack.length === 0) return;
  currentPath = historyStack.pop();
  refresh();
});

document.querySelectorAll('.nf-nav-item').forEach((btn) => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.goto));
});

searchBox.addEventListener('input', applyFilter);

document.getElementById('btnNewFolder').addEventListener('click', () => {
  document.getElementById('newFolderName').value = '';
  new bootstrap.Modal(document.getElementById('modalNewFolder')).show();
});

document.getElementById('confirmNewFolder').addEventListener('click', async () => {
  const name = document.getElementById('newFolderName').value.trim();
  if (!name) return;
  const res = await apiMkdir(currentPath, name);
  bootstrap.Modal.getInstance(document.getElementById('modalNewFolder')).hide();
  if (res.error) return showToast(res.error, 'danger');
  showToast(`Folder "${name}" created`);
  refresh();
});

document.getElementById('confirmRename').addEventListener('click', async () => {
  const newName = document.getElementById('renameInput').value.trim();
  if (!newName) return;
  const res = await apiRename(renameTargetPath, newName);
  bootstrap.Modal.getInstance(document.getElementById('modalRename')).hide();
  if (res.error) return showToast(res.error, 'danger');
  showToast('Renamed successfully');
  refresh();
});

document.getElementById('btnUpload').addEventListener('click', () => {
  document.getElementById('fileInput').click();
});

document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`/api/upload?path=${encodeURIComponent(currentPath)}`, {
    method: 'POST', body: formData,
  });
  const data = await res.json();
  if (data.error) showToast(data.error, 'danger');
  else showToast(`"${file.name}" uploaded`);
  e.target.value = '';
  refresh();
});

refresh();
