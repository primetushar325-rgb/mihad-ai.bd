import { api, ensureCsrf, uploadForm } from './api.js';
import { $, $$, buttonLoading, copyText, dateText, debounce, escapeHTML as esc, formatBytes, formatNumber, hideLoader, hydrateIcons, icon, setProgress, timeAgo, toast } from './ui.js';

const routes = {
  dashboard: { path: '/dashboard', title: 'Dashboard', description: 'Your creator operations at a glance.', icon: 'grid' },
  upload: { path: '/upload', title: 'Upload Studio', description: 'Publish or schedule an authorized video.', icon: 'upload-cloud' },
  channels: { path: '/channels', title: 'Channel Manager', description: 'Secure multi-channel authorization.', icon: 'radio' },
  'bulk-editor': { path: '/bulk-editor', title: 'Bulk Video Editor', description: 'Safe batch metadata operations.', icon: 'edit-3' },
  seo: { path: '/seo', title: 'SEO Analyzer', description: 'Explainable metadata optimization.', icon: 'target' },
  assistant: { path: '/assistant', title: 'AI Assistant', description: 'Creative directions with human review.', icon: 'sparkles' },
  thumbnails: { path: '/thumbnails', title: 'Thumbnail Center', description: 'Visual assets from your library.', icon: 'image' },
  'url-analyzer': { path: '/url-analyzer', title: 'URL Analyzer', description: 'Official public YouTube API data.', icon: 'link' },
  analytics: { path: '/analytics', title: 'Analytics', description: 'Operational workspace insights.', icon: 'bar-chart' },
  settings: { path: '/settings', title: 'Settings', description: 'Workspace and account preferences.', icon: 'settings' },
  'api-manager': { path: '/api-manager', title: 'API Manager', description: 'Service readiness and secure quota.', icon: 'database' }
};
const state = {
  user: null,
  channels: [],
  dashboard: null,
  uploads: [],
  bulkVideos: [],
  bulkSelected: new Set(),
  thumbnailVideos: [],
  aiItems: [],
  aiType: 'titles',
  currentPage: 'dashboard',
  chartData: [],
  confirmResolve: null
};
const pathToPage = Object.fromEntries(Object.entries(routes).map(([key, value]) => [value.path, key]));

hydrateIcons();

function pageFromPath() { return pathToPage[location.pathname] || 'dashboard'; }
function setText(selector, value) { const node = $(selector); if (node) node.textContent = value; }
function initials(name = 'M') { return name.trim().split(/\s+/).slice(0,2).map((part) => part[0]).join('').toUpperCase() || 'M'; }
function compact(value) { return formatNumber(Number(value) || 0); }
function safeImage(url) { return /^https:\/\/(i\d*\.ytimg\.com|yt3\.(ggpht|googleusercontent)\.com)\//.test(url || '') ? url : '/assets/img/logo.svg'; }
function thumbnailDownload(url, filename = 'youtube-thumbnail') { return `/api/youtube/thumbnails/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename.replace(/[^\w.-]/g, '-').slice(0, 90))}`; }
function statusLabel(status) { return ({ queued:'Queued', uploading:'Uploading', processing:'Processing', scheduled:'Scheduled', published:'Published', completed:'Complete', failed:'Failed' }[status] || status || 'Unknown'); }
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#sidebarScrim').classList.remove('open'); }

function applyUser() {
  const user = state.user;
  const first = user.name.split(/\s+/)[0];
  setText('#sideUserName', user.name); setText('#sideUserEmail', user.email);
  setText('#topUserName', user.name); setText('#greetingName', first);
  setText('#sideAvatar', initials(user.name)); setText('#topAvatar', initials(user.name)); setText('#settingsAvatar', initials(user.name));
  setText('#settingsDisplayName', user.name); setText('#settingsDisplayEmail', user.email);
  const profile = $('#profileForm');
  if (profile) { profile.name.value = user.name; profile.email.value = user.email; profile.timezone.value = user.settings?.timezone || 'Asia/Dhaka'; }
  const notifications = $('#notificationsForm');
  if (notifications) { notifications.emailNotifications.checked = user.settings?.emailNotifications !== false; notifications.uploadNotifications.checked = user.settings?.uploadNotifications !== false; }
  const appearance = $('#appearanceForm');
  if (appearance) appearance.compactMode.checked = Boolean(user.settings?.compactMode);
  document.body.classList.toggle('compact-mode', Boolean(user.settings?.compactMode));
  const hour = new Date().getHours();
  setText('#greetingTime', hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening');
}

function navigate(page, push = true) {
  if (!routes[page]) page = 'dashboard';
  state.currentPage = page;
  if (push && location.pathname !== routes[page].path) history.pushState({ page }, '', routes[page].path);
  $$('.page').forEach((section) => section.classList.toggle('hidden', section.dataset.page !== page));
  $$('[data-page-link]').forEach((link) => link.classList.toggle('active', link.dataset.pageLink === page));
  setText('#topbarTitle', routes[page].title);
  setText('#breadcrumbCurrent', routes[page].title);
  document.title = `${routes[page].title} — Mihad AI`;
  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'instant' });
  loadPage(page).catch(handleError);
}

async function loadPage(page) {
  if (page === 'dashboard') return loadDashboard();
  if (page === 'channels') return renderChannels();
  if (page === 'upload') return loadUploads();
  if (page === 'analytics') return loadDashboard(true);
  if (page === 'api-manager') return loadApiStatus();
  if (page === 'bulk-editor' && $('#bulkChannel').value) return loadBulkVideos();
  if (page === 'thumbnails' && $('#thumbnailChannel').value) return loadThumbnailVideos();
}

function handleError(error) {
  if (error?.status === 401) { location.assign('/login'); return; }
  toast(error?.message || 'Something went wrong.', 'error');
}

async function loadChannels() {
  const data = await api('/api/youtube/channels');
  state.channels = data.channels || [];
  setText('#channelNavCount', state.channels.length);
  populateChannelSelects();
  if (state.currentPage === 'channels') renderChannels();
  return state.channels;
}

function populateChannelSelects() {
  const options = state.channels.map((channel) => `<option value="${esc(channel.id)}">${esc(channel.title)}${channel.status !== 'connected' ? ' — attention required' : ''}</option>`).join('');
  [['#uploadChannel','Select a connected channel'],['#bulkChannel','Select channel'],['#thumbnailChannel','Select channel']].forEach(([selector, label]) => {
    const select = $(selector); if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">${label}</option>${options}`;
    if (state.channels.some((channel) => channel.id === current)) select.value = current;
  });
}

async function loadDashboard(force = false) {
  if (state.dashboard && !force) { renderDashboard(state.dashboard); return; }
  const data = await api('/api/dashboard');
  state.dashboard = data;
  renderDashboard(data);
}

function renderDashboard(data) {
  if (!data) return;
  const { overview, quota, recentUploads = [], activities = [], uploadTimeline = [], channels = [] } = data;
  setText('#statUploads', formatNumber(overview.totalUploads));
  setText('#statChannels', formatNumber(overview.connectedChannels));
  setText('#statSuccess', overview.successRate);
  setText('#statFailed', overview.failed);
  setText('#statQuota', formatNumber(quota.remaining));
  setText('#sideQuotaPercent', `${quota.percentage}%`); setText('#sideQuotaUsed', formatNumber(quota.used)); setText('#sideQuotaLimit', formatNumber(quota.limit));
  setText('#quotaPercent', `${quota.percentage}%`); setText('#quotaUsed', formatNumber(quota.used)); setText('#quotaRemaining', formatNumber(quota.remaining));
  setProgress($('#sideQuotaBar'), quota.percentage);
  $('#quotaRing').style.strokeDashoffset = String(377 - 377 * quota.percentage / 100);
  $('#successRing').style.strokeDashoffset = String(100 - overview.successRate);
  $('#quotaDots').innerHTML = Array.from({length:15}, (_,i) => `<i class="${i < Math.round((100-quota.percentage)/100*15) ? 'on' : ''}"></i>`).join('');
  state.chartData = uploadTimeline;
  drawLineChart($('#uploadChart'), uploadTimeline, '#00ff66');
  drawLineChart($('#analyticsChart'), uploadTimeline, '#00ff66', true);
  $('#chartEmpty').classList.toggle('hidden', uploadTimeline.some((x) => x.count));
  renderRecentUploads(recentUploads);
  renderActivities(activities);
  renderAnalytics({ overview, channels, uploadTimeline });
}

function renderRecentUploads(jobs) {
  const body = $('#recentUploads'); if (!body) return;
  if (!jobs.length) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-mini">${icon('upload-cloud')}<b>No uploads yet</b><small>Queue your first secure upload to start the pipeline.</small></div></td></tr>`;
    return;
  }
  body.innerHTML = jobs.map((job) => `<tr>
    <td><div class="video-cell"><span class="video-thumb" style="display:grid;place-items:center;color:#00ff66">${icon('film')}</span><span><b>${esc(job.title)}</b><small>${esc(job.sourceFilename || 'Video media')}</small></span></div></td>
    <td><div class="channel-cell"><b>${esc(job.channelId?.title || 'Connected channel')}</b><small>Authorized</small></div></td>
    <td><span class="status-pill ${esc(job.status)}">${esc(statusLabel(job.status))}</span></td>
    <td><div class="table-progress"><div class="progress-track"><i style="width:${Number(job.progress)||0}%"></i></div><small>${Number(job.progress)||0}% · ${esc(job.stage || '')}</small></div></td>
    <td>${esc(timeAgo(job.createdAt))}</td></tr>`).join('');
}

function renderActivities(items) {
  const list = $('#activityList'); if (!list) return;
  if (!items.length) { list.innerHTML = `<div class="empty-mini">${icon('activity')}<b>No activity recorded</b><small>Your secure audit trail starts with your first action.</small></div>`; return; }
  const typeIcon = { upload:'upload-cloud', channel:'radio', seo:'target', ai:'sparkles', auth:'shield-check', account:'user', bulk_edit:'edit-3', settings:'settings', security:'shield' };
  list.innerHTML = items.map((item) => `<div class="activity-item"><i>${icon(typeIcon[item.type] || 'activity')}</i><span><b>${esc(item.title)}</b><small>${esc(item.detail || item.type)}</small></span><time>${esc(timeAgo(item.createdAt))}</time></div>`).join('');
}

function drawLineChart(canvas, data = [], color = '#00ff66', filled = false) {
  if (!canvas || canvas.offsetWidth === 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth || 600, height = canvas.clientHeight || 260;
  canvas.width = width * dpr; canvas.height = height * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,width,height);
  const pad = { l: 32, r: 16, t: 20, b: 30 }, w = width-pad.l-pad.r, h = height-pad.t-pad.b;
  ctx.strokeStyle = 'rgba(158,255,195,.07)'; ctx.lineWidth = 1;
  for (let i=0;i<5;i++) { const y=pad.t+h*i/4; ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(width-pad.r,y); ctx.stroke(); }
  ctx.fillStyle = '#647168'; ctx.font = '9px Inter'; ctx.textAlign = 'center';
  const points = data.length ? data : Array.from({length:7},(_,i)=>({label:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i],count:0}));
  const max = Math.max(3,...points.map(x=>Number(x.count)||0));
  const coords = points.map((point,index) => ({ x: pad.l + (points.length === 1 ? w/2 : w*index/(points.length-1)), y: pad.t+h-(Number(point.count)||0)/max*h, point }));
  coords.forEach(({x,point}) => ctx.fillText(point.label || '', x, height-7));
  if (!data.some((x)=>x.count)) return;
  const gradient = ctx.createLinearGradient(0,pad.t,0,pad.t+h); gradient.addColorStop(0,'rgba(0,255,102,.24)'); gradient.addColorStop(1,'rgba(0,255,102,0)');
  ctx.beginPath(); coords.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
  if (filled || true) { ctx.lineTo(coords.at(-1).x,pad.t+h); ctx.lineTo(coords[0].x,pad.t+h); ctx.closePath(); ctx.fillStyle=gradient; ctx.fill(); }
  ctx.beginPath(); coords.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y)); ctx.strokeStyle=color; ctx.lineWidth=2; ctx.shadowColor=color; ctx.shadowBlur=9; ctx.stroke(); ctx.shadowBlur=0;
  coords.forEach((p) => { ctx.beginPath(); ctx.arc(p.x,p.y,3.2,0,Math.PI*2); ctx.fillStyle='#071008'; ctx.fill(); ctx.strokeStyle=color; ctx.lineWidth=2; ctx.stroke(); });
}

function renderAnalytics({ overview, channels }) {
  setText('#analyticsUploads', formatNumber(overview.totalUploads));
  setText('#analyticsViews', compact(channels.reduce((sum,c)=>sum+Number(c.viewCount||0),0)));
  setText('#analyticsSubs', compact(channels.reduce((sum,c)=>sum+Number(c.subscriberCount||0),0)));
  setText('#analyticsSuccess', `${overview.successRate}%`);
  const list = $('#channelRankList'); if (!list) return;
  if (!channels.length) { list.innerHTML = `<div class="empty-mini">${icon('radio')}<b>No channels connected</b><small>Connect channels to see network distribution.</small></div>`; return; }
  const total = Math.max(1, channels.reduce((sum,c)=>sum+Number(c.viewCount||0),0));
  list.innerHTML = [...channels].sort((a,b)=>b.viewCount-a.viewCount).map((channel) => `<div class="channel-rank"><img src="${esc(safeImage(channel.thumbnailUrl))}" alt=""><span><b>${esc(channel.title)}</b><small>${compact(channel.viewCount)} views · ${compact(channel.subscriberCount)} subscribers</small></span><em>${Math.round(channel.viewCount/total*100)}%</em></div>`).join('');
}
/* Channel manager */
function renderChannels() {
  const grid = $('#channelGrid'); if (!grid) return;
  const channels = state.channels;
  setText('#channelTotal', channels.length);
  setText('#channelHealthy', channels.filter((x)=>x.status==='connected').length);
  setText('#channelViews', compact(channels.reduce((sum,x)=>sum+Number(x.viewCount||0),0)));
  setText('#channelVideos', compact(channels.reduce((sum,x)=>sum+Number(x.videoCount||0),0)));
  if (!channels.length) {
    grid.innerHTML = `<div class="empty-state glass-card"><span>${icon('radio')}</span><h3>Connect your first channel</h3><p>Authorize a YouTube channel to unlock publishing, video management, and private workspace analytics.</p><button class="btn btn-primary" data-connect-channel>${icon('plus')} Connect channel</button></div>`;
    return;
  }
  grid.innerHTML = channels.map((channel) => `<article class="channel-card glass-card" data-channel-card="${esc(channel.id)}"><div class="channel-cover"><span class="channel-status ${esc(channel.status)}"><i></i>${esc(channel.status === 'connected' ? 'Healthy' : 'Attention')}</span></div><div class="channel-content"><div class="channel-identity"><img class="channel-avatar" src="${esc(safeImage(channel.thumbnailUrl))}" alt="${esc(channel.title)}"><div><h3>${esc(channel.title)}</h3><small>${esc(channel.handle || channel.youtubeChannelId)}</small></div></div><div class="channel-metrics"><span><b>${compact(channel.subscriberCount)}</b><small>Subscribers</small></span><span><b>${compact(channel.viewCount)}</b><small>Views</small></span><span><b>${compact(channel.videoCount)}</b><small>Videos</small></span></div><div class="channel-card-foot"><small>Synced ${esc(timeAgo(channel.lastSyncedAt))}</small><div class="channel-card-actions"><button class="icon-btn" data-channel-sync="${esc(channel.id)}" title="Refresh channel">${icon('refresh-cw')}</button><button class="icon-btn" data-channel-remove="${esc(channel.id)}" title="Remove channel">${icon('trash')}</button></div></div></div></article>`).join('');
}

async function connectChannel(button) {
  buttonLoading(button, true, 'Opening Google...');
  try { const { url } = await api('/api/youtube/oauth/start'); location.assign(url); }
  catch (error) { buttonLoading(button,false); handleError(error); }
}

async function syncChannel(id, button) {
  buttonLoading(button,true,'');
  try {
    const { channel } = await api(`/api/youtube/channels/${id}/sync`, { method:'POST' });
    const index = state.channels.findIndex((x)=>x.id===id); if (index >= 0) state.channels[index] = channel;
    renderChannels(); populateChannelSelects(); toast(`${channel.title} is synchronized.`);
  } catch (error) { handleError(error); buttonLoading(button,false); }
}

async function removeChannel(id) {
  const channel = state.channels.find((x)=>x.id===id);
  if (!await confirmAction({ title:'Remove channel access?', message:`Mihad AI will revoke and delete its stored authorization for ${channel?.title || 'this channel'}. Existing YouTube content is not deleted.`, confirm:'Remove access', danger:true })) return;
  try {
    await api(`/api/youtube/channels/${id}`, { method:'DELETE' });
    state.channels = state.channels.filter((x)=>x.id!==id); populateChannelSelects(); renderChannels(); toast('Channel access removed.','warning');
  } catch (error) { handleError(error); }
}

/* Upload studio */
async function loadPlaylists(channelId, ...selectors) {
  const targets = selectors.map((s)=>$(s)).filter(Boolean);
  targets.forEach((select)=>select.innerHTML='<option value="">Loading playlists...</option>');
  if (!channelId) { targets.forEach((select)=>select.innerHTML='<option value="">No playlist</option>'); return []; }
  try {
    const { playlists } = await api(`/api/youtube/channels/${channelId}/playlists`);
    targets.forEach((select) => select.innerHTML = `<option value="">${select.id === 'bulkPlaylist' ? 'Select playlist' : 'No playlist'}</option>${playlists.map((p)=>`<option value="${esc(p.id)}">${esc(p.title)} (${p.itemCount})</option>`).join('')}`);
    return playlists;
  } catch (error) { targets.forEach((select)=>select.innerHTML='<option value="">Unable to load</option>'); handleError(error); return []; }
}

async function loadUploads() {
  const { jobs } = await api('/api/youtube/uploads?limit=40');
  state.uploads = jobs;
  renderUploadHistory();
  if (jobs.some((job)=>['queued','uploading','processing'].includes(job.status))) scheduleUploadPoll();
}
let uploadPoll;
function scheduleUploadPoll() {
  clearTimeout(uploadPoll);
  uploadPoll = setTimeout(async () => {
    if (!['upload','dashboard'].includes(state.currentPage)) return;
    try { await loadUploads(); if (state.currentPage === 'dashboard') await loadDashboard(true); } catch {}
  }, 4000);
}

function renderUploadHistory() {
  const list = $('#uploadHistoryList'); if (!list) return;
  if (!state.uploads.length) { list.innerHTML = `<div class="empty-mini">${icon('history')}<b>No upload history</b><small>Completed and failed upload jobs will appear here.</small></div>`; return; }
  list.innerHTML = state.uploads.map((job) => `<div class="upload-history-item"><div><b>${esc(job.title)}</b><small>${esc(job.channelId?.title || 'Channel')} · ${esc(job.stage)} · ${formatBytes(job.bytes)} · ${timeAgo(job.createdAt)}</small><div class="progress-track"><i style="width:${Number(job.progress)||0}%"></i></div>${job.errorMessage ? `<small style="color:#ff9299">${esc(job.errorMessage)}</small>` : ''}</div><span><span class="status-pill ${esc(job.status)}">${esc(statusLabel(job.status))}</span>${job.status === 'failed' ? `<button class="text-button" data-retry-upload="${esc(job.id)}">Retry</button>` : ''}</span></div>`).join('');
}

function updatePreflight() {
  const form = $('#uploadForm'); if (!form) return;
  const checks = {
    video: Boolean(form.video.files[0]), channel: Boolean(form.channelId.value), title: form.title.value.trim().length >= 10,
    description: form.description.value.trim().length >= 50, privacy: Boolean(form.querySelector('[name="privacy"]:checked'))
  };
  let score = 0;
  Object.entries(checks).forEach(([key,done]) => { const item = $(`[data-check="${key}"]`); if (!item) return; item.classList.toggle('done',done); item.innerHTML = `${icon(done?'check-circle':'circle')} ${esc(item.textContent.trim())}`; if(done) score++; });
  setText('#preflightScore',`${score}/5`);
}

async function handleUploadSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  if (!form.video.files[0]) return toast('Select a video file first.','warning');
  const schedule = $('#scheduleToggle').checked;
  if (schedule && !form.scheduledAt.value) return toast('Choose a schedule date and time.','warning');
  const submit = form.querySelector('[type="submit"]');
  const progressCard = $('#uploadProgressCard');
  progressCard.classList.remove('hidden');
  setText('#uploadProgressTitle','Transferring media'); setText('#uploadProgressDetail','Keep this tab open while your file reaches the secure server.'); setText('#uploadPercent','0%'); setProgress($('#uploadProgressBar'),0);
  buttonLoading(submit,true,'Transferring...');
  const data = new FormData(form);
  if (!schedule) data.delete('scheduledAt');
  try {
    const { job } = await uploadForm('/api/youtube/uploads', data, (percent) => { setText('#uploadPercent',`${percent}%`); setProgress($('#uploadProgressBar'),percent); });
    setText('#uploadPercent','95%'); setProgress($('#uploadProgressBar'),95); setText('#uploadProgressTitle','YouTube processing queued'); setText('#uploadProgressDetail','The secure worker is now publishing metadata and media. You may leave this page.');
    toast('Upload queued securely. Progress will update in history.');
    form.reset(); $('#scheduleField').classList.add('hidden'); resetSelectedFile(); updateCountsAndPreflight();
    state.uploads.unshift(job); renderUploadHistory(); $('#uploadHistoryPanel').classList.remove('hidden'); scheduleUploadPoll();
  } catch (error) { progressCard.classList.add('hidden'); handleError(error); }
  finally { buttonLoading(submit,false); }
}

function resetSelectedFile() {
  const selected = $('.selected-file'); if (selected) selected.classList.add('hidden');
  const fileButton = $('.file-button span'); if (fileButton) fileButton.innerHTML='<b>Choose image</b><small>JPG or PNG · up to 2 MB</small>';
}
function updateCountsAndPreflight() {
  const form = $('#uploadForm'); if (!form) return;
  setText('#titleCount', form.title.value.length); setText('#descriptionCount', form.description.value.length); updatePreflight();
}

async function retryUpload(id, button) {
  buttonLoading(button,true,'Retrying...');
  try { await api(`/api/youtube/uploads/${id}/retry`,{method:'POST'}); toast('Upload queued for retry.'); await loadUploads(); }
  catch(error){ handleError(error); buttonLoading(button,false); }
}
/* Bulk editor */
async function loadBulkVideos() {
  const channelId = $('#bulkChannel').value;
  if (!channelId) { state.bulkVideos=[]; state.bulkSelected.clear(); renderBulkVideos(); return; }
  const list = $('#bulkVideoList'); list.innerHTML = `<div class="empty-mini"><div class="skeleton-list" style="width:100%"><i></i><i></i><i></i></div></div>`;
  try {
    const [{ videos }] = await Promise.all([api(`/api/youtube/channels/${channelId}/videos?limit=50`), loadPlaylists(channelId,'#bulkPlaylist')]);
    state.bulkVideos = videos; state.bulkSelected.clear(); renderBulkVideos();
  } catch(error){ handleError(error); list.innerHTML=`<div class="empty-state compact"><span>${icon('alert-triangle')}</span><h3>Library unavailable</h3><p>${esc(error.message)}</p></div>`; }
}
function filteredBulkVideos() {
  const q = $('#bulkSearch').value.trim().toLowerCase();
  return q ? state.bulkVideos.filter((v)=>v.title.toLowerCase().includes(q)) : state.bulkVideos;
}
function renderBulkVideos() {
  const list=$('#bulkVideoList'), videos=filteredBulkVideos();
  if (!$('#bulkChannel').value) list.innerHTML=`<div class="empty-state compact"><span>${icon('film')}</span><h3>Select a channel</h3><p>Your latest authorized videos will appear here.</p></div>`;
  else if (!videos.length) list.innerHTML=`<div class="empty-state compact"><span>${icon('search')}</span><h3>No videos found</h3><p>Try a different search or refresh the channel library.</p></div>`;
  else list.innerHTML=videos.map((video)=>`<label class="video-select-item ${state.bulkSelected.has(video.id)?'selected':''}" data-video-row="${esc(video.id)}"><span class="check"><input type="checkbox" data-video-select="${esc(video.id)}" ${state.bulkSelected.has(video.id)?'checked':''}><i></i></span><img src="${esc(safeImage(video.thumbnail))}" alt=""><span><b>${esc(video.title)}</b><small>${esc(video.privacy||'unknown')} · ${compact(video.statistics?.views)} views · ${dateText(video.publishedAt)}</small></span></label>`).join('');
  updateBulkSelection();
}
function updateBulkSelection() {
  setText('#selectedVideoCount',state.bulkSelected.size); $('#openBulkPanel').disabled=!state.bulkSelected.size;
  $('#selectAllVideos').checked=Boolean(filteredBulkVideos().length)&&filteredBulkVideos().every((v)=>state.bulkSelected.has(v.id));
}
async function submitBulkEdit(event) {
  event.preventDefault();
  if (!state.bulkSelected.size) return toast('Select at least one video.','warning');
  const changes={};
  if ($('[data-enable="bulkTitle"]').checked) changes.title=$('#bulkTitle').value;
  if ($('[data-enable="bulkDescription"]').checked) changes.description=$('#bulkDescription').value;
  if ($('[data-enable="bulkTags"]').checked) changes.tags=$('#bulkTags').value.split(',').map(x=>x.trim()).filter(Boolean);
  if ($('[data-enable="bulkPrivacy"]').checked) changes.privacy=$('#bulkPrivacy').value;
  if ($('[data-enable="bulkPlaylist"]').checked) changes.playlistId=$('#bulkPlaylist').value;
  if (!Object.keys(changes).length) return toast('Enable at least one batch change.','warning');
  if (changes.title !== undefined && !changes.title.trim()) return toast('Enter a title template or disable title updates.','warning');
  const confirmed=await confirmAction({title:'Apply batch changes?',message:`This will update ${state.bulkSelected.size} verified video${state.bulkSelected.size===1?'':'s'} on the selected authorized channel. YouTube quota units will be consumed.`,confirm:'Apply changes'});
  if(!confirmed)return;
  const button=event.currentTarget.querySelector('[type="submit"]'); buttonLoading(button,true,'Applying changes...');
  try{
    const data=await api('/api/youtube/bulk-update',{method:'POST',body:{channelId:$('#bulkChannel').value,videoIds:[...state.bulkSelected],changes}});
    toast(`${data.succeeded} video${data.succeeded===1?'':'s'} updated${data.failed?`; ${data.failed} failed`:'.'}`,data.failed?'warning':'success','Batch complete');
    await loadBulkVideos();
  }catch(error){handleError(error);}finally{buttonLoading(button,false);}
}

/* SEO analyzer */
function restoreSeoDraft(){try{const draft=JSON.parse(localStorage.getItem('mihad-seo-draft')||'{}'),form=$('#seoForm'); for(const key of ['keyword','title','description','tags'])if(draft[key])form.elements[key].value=draft[key]; updateSeoCounts();}catch{}}
function saveSeoDraft(){const form=$('#seoForm'); localStorage.setItem('mihad-seo-draft',JSON.stringify(Object.fromEntries(new FormData(form))));}
function updateSeoCounts(){setText('[data-count-for="seoTitle"]',$('#seoTitle').value.length);setText('[data-count-for="seoDescription"]',$('#seoDescription').value.length);}
async function submitSeo(event){
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');buttonLoading(button,true,'Analyzing signal...');
  try{const tags=form.tags.value.split(',').map(x=>x.trim()).filter(Boolean);const {result}=await api('/api/tools/seo/analyze',{method:'POST',body:{title:form.title.value,description:form.description.value,keyword:form.keyword.value,tags}});renderSeoResult(result);}
  catch(error){handleError(error);}finally{buttonLoading(button,false);}
}
function renderSeoResult(result){
  setText('#seoScore',result.score);setText('#seoGrade',result.grade);setText('#seoSummary',result.score>=75?'Your metadata has a strong foundation. Review the remaining opportunities.':'Use the checklist below to strengthen clarity and discovery signals.');
  $('#seoScoreRing').style.strokeDashoffset=String(440-440*result.score/100);const passed=result.checks.filter(x=>x.passed).length;setText('#checkPassed',`${passed}/${result.checks.length} passed`);
  $('#seoChecklist').innerHTML=result.checks.map(check=>`<div class="seo-check ${check.passed?'passed':''}"><i>${icon(check.passed?'check':'x')}</i><span><b>${esc(check.label)}</b><small>${esc(check.passed?'Best practice satisfied.':check.tip)}</small></span><em>+${check.earned}/${check.points}</em></div>`).join('');
  $('#seoTagSuggestions').innerHTML=result.tagSuggestions.length?result.tagSuggestions.map(tag=>`<button type="button" data-copy-tag="${esc(tag)}">${esc(tag)}</button>`).join(''):'<span class="muted-tag">Add more descriptive copy for suggestions</span>';
}
function clearSeo(){const form=$('#seoForm');form.reset();localStorage.removeItem('mihad-seo-draft');updateSeoCounts();setText('#seoScore','—');setText('#seoGrade','Ready to analyze');setText('#seoSummary','Add your metadata to receive an explainable optimization score.');$('#seoScoreRing').style.strokeDashoffset='440';setText('#checkPassed','0/9 passed');$('#seoChecklist').innerHTML=`<div class="empty-mini">${icon('target')}<b>No analysis yet</b><small>Your actionable checklist will appear here.</small></div>`;$('#seoTagSuggestions').innerHTML='<span class="muted-tag">Suggestions pending</span>';}

/* AI assistant */
const aiTitles={titles:'Generate video titles',descriptions:'Generate descriptions',hashtags:'Generate hashtags',tags:'Generate video tags',thumbnails:'Generate thumbnail ideas'};
function selectAiType(type){state.aiType=type;$$('[data-ai-type]').forEach(b=>b.classList.toggle('active',b.dataset.aiType===type));setText('#aiPromptTitle',aiTitles[type]);}
async function submitAi(event){
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');if(!form.reportValidity())return;
  $('#aiOutput').innerHTML=`<div class="ai-loading"><span>${icon('sparkles')}</span><b>Mapping creative directions</b><small>Building useful, editable starting points...</small></div>`;buttonLoading(button,true,'Generating...');
  try{const {result}=await api('/api/tools/ai/generate',{method:'POST',body:{type:state.aiType,topic:form.topic.value.trim(),tone:form.tone.value,audience:form.audience.value.trim()||'general',keywords:form.keywords.value.split(',').map(x=>x.trim()).filter(Boolean)}});state.aiItems=result.items;renderAiItems(result);}
  catch(error){handleError(error);$('#aiOutput').innerHTML=`<div class="ai-empty"><span>${icon('alert-triangle')}</span><h3>Generation interrupted</h3><p>${esc(error.message)}</p></div>`;}finally{buttonLoading(button,false);}
}
function renderAiItems(result){setText('#aiSourceBadge',result.source==='ai'?'MODEL':'TEMPLATE');$('#aiSourceBadge').classList.remove('hidden');setText('#aiModeLabel',result.source==='ai'?'AI provider connected':'Secure template mode');$('#aiOutput').innerHTML=result.items.map((item,i)=>`<div class="ai-result-item"><b>${String(i+1).padStart(2,'0')}</b><p>${esc(item)}</p><button class="icon-btn" data-copy-ai="${i}" title="Copy">${icon('copy')}</button></div>`).join('');if(result.note)toast(result.note,'warning','Template mode');}
/* Thumbnail Center */
async function loadThumbnailVideos(){
  const channelId=$('#thumbnailChannel').value;if(!channelId){state.thumbnailVideos=[];renderThumbnails();return;}
  $('#thumbnailGrid').innerHTML=`<div class="empty-state glass-card"><div class="skeleton-list" style="width:100%"><i></i><i></i><i></i></div></div>`;
  try{const {videos}=await api(`/api/youtube/channels/${channelId}/videos?limit=40`);state.thumbnailVideos=videos;renderThumbnails();}catch(error){handleError(error);}
}
function renderThumbnails(){
  const grid=$('#thumbnailGrid'),query=$('#thumbnailSearch').value.trim().toLowerCase();let videos=state.thumbnailVideos;if(query)videos=videos.filter(v=>v.title.toLowerCase().includes(query));
  if(!$('#thumbnailChannel').value){grid.innerHTML=`<div class="empty-state glass-card"><span>${icon('image')}</span><h3>Choose a channel library</h3><p>We’ll load public thumbnail assets attached to your latest videos.</p></div>`;return;}
  if(!videos.length){grid.innerHTML=`<div class="empty-state glass-card"><span>${icon('search')}</span><h3>No thumbnails found</h3><p>Try another search or channel library.</p></div>`;return;}
  grid.innerHTML=videos.map(video=>`<article class="thumbnail-card glass-card"><div class="thumbnail-image"><img src="${esc(safeImage(video.thumbnail))}" alt="${esc(video.title)}"><span class="thumbnail-resolution">${video.thumbnails?.maxres?'1280 × 720':'High quality'}</span></div><div class="thumbnail-info"><h3>${esc(video.title)}</h3><div class="thumbnail-actions"><small>${dateText(video.publishedAt)}</small><a href="${esc(thumbnailDownload(video.thumbnail,`${video.id}-thumbnail`))}" download>${icon('download')} Download</a></div></div></article>`).join('');
}

/* URL Analyzer */
async function submitUrlAnalyzer(event){
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');if(!form.reportValidity())return;buttonLoading(button,true,'Analyzing...');
  try{const {video}=await api('/api/youtube/analyze',{method:'POST',body:{url:form.url.value.trim()}});renderAnalyzedVideo(video);}
  catch(error){handleError(error);}finally{buttonLoading(button,false);}
}
function renderAnalyzedVideo(video){
  $('#analyzerEmpty').classList.add('hidden');$('#analyzerResult').classList.remove('hidden');$('#analyzerThumb').src=safeImage(video.thumbnail);setText('#analyzerTitle',video.title);setText('#analyzerChannel',video.channelTitle);setText('#analyzerDate',dateText(video.publishedAt));setText('#analyzerDescription',video.description||'No public description is available.');setText('#analyzerViews',compact(video.statistics.views));setText('#analyzerLikes',compact(video.statistics.likes));setText('#analyzerComments',compact(video.statistics.comments));setText('#analyzerDuration',formatDuration(video.duration));$('#analyzerWatch').href=video.url;
  const thumbs=Object.entries(video.thumbnails||{}).reverse();$('#thumbnailDownloads').innerHTML=thumbs.length?thumbs.map(([name,item])=>`<a href="${esc(thumbnailDownload(item.url,`${video.id}-${name}`))}" download><img src="${esc(safeImage(item.url))}" alt=""><span><b>${esc(name)}</b><small>${item.width||'—'} × ${item.height||'—'} pixels</small></span>${icon('download')}</a>`).join(''):`<div class="empty-mini"><b>No thumbnail assets returned</b></div>`;
}
function formatDuration(iso=''){const m=iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);if(!m)return '—';const h=Number(m[1]||0),min=Number(m[2]||0),sec=Number(m[3]||0);return h?`${h}:${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${min}:${String(sec).padStart(2,'0')}`;}

/* Settings */
function showSaved(){const node=$('#settingsSaved');node.classList.add('show');setTimeout(()=>node.classList.remove('show'),2200);}
async function saveProfile(event){event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');buttonLoading(button,true,'Saving...');try{const {user}=await api('/api/settings/profile',{method:'PATCH',body:{name:form.name.value.trim(),settings:{timezone:form.timezone.value}}});state.user=user;applyUser();showSaved();toast('Profile settings updated.');}catch(error){handleError(error);}finally{buttonLoading(button,false);}}
async function saveNotifications(event){event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');buttonLoading(button,true,'Saving...');try{const {user}=await api('/api/settings/profile',{method:'PATCH',body:{settings:{emailNotifications:form.emailNotifications.checked,uploadNotifications:form.uploadNotifications.checked}}});state.user=user;applyUser();showSaved();}catch(error){handleError(error);}finally{buttonLoading(button,false);}}
async function changePassword(event){event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;const button=form.querySelector('[type="submit"]');buttonLoading(button,true,'Updating...');try{await api('/api/settings/password',{method:'PATCH',body:{currentPassword:form.currentPassword.value,newPassword:form.newPassword.value}});form.reset();showSaved();toast('Password updated securely.');}catch(error){handleError(error);}finally{buttonLoading(button,false);}}
async function saveAppearance(event){event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');buttonLoading(button,true,'Applying...');try{const {user}=await api('/api/settings/profile',{method:'PATCH',body:{settings:{compactMode:form.compactMode.checked}}});state.user=user;applyUser();showSaved();}catch(error){handleError(error);}finally{buttonLoading(button,false);}}

/* API manager */
async function loadApiStatus(){
  const list=$('#serviceList');list.innerHTML='<div class="skeleton-list"><i></i><i></i><i></i></div>';
  try{const data=await api('/api/dashboard/api-status');list.innerHTML=data.services.map(service=>`<div class="service-item"><i class="${service.configured?'':'off'}">${icon(service.configured?'check-circle':'alert-triangle')}</i><span><b>${esc(service.name)}</b><small>${esc(service.detail)}</small></span><em class="${service.configured?'':'off'}">${service.configured?'READY':'ACTION'}</em></div>`).join('');const q=data.quota,p=q.percentage;setText('#apiQuotaPercent',`${p}%`);setText('#apiQuotaUsed',formatNumber(q.used));setText('#apiQuotaLimit',formatNumber(q.limit));$('#apiQuotaRing').style.strokeDashoffset=String(377-377*p/100);}
  catch(error){handleError(error);list.innerHTML=`<div class="empty-mini">${icon('alert-triangle')}<b>Status unavailable</b><small>${esc(error.message)}</small></div>`;}
}

/* Confirmation dialog and command palette */
function confirmAction({title,message,confirm='Confirm',danger=false}){
  setText('#confirmTitle',title);setText('#confirmMessage',message);setText('#confirmAction',confirm);$('#confirmAction').className=`btn ${danger?'btn-danger':'btn-primary'}`;$('#confirmModal').classList.remove('hidden');
  return new Promise((resolve)=>{state.confirmResolve=resolve;});
}
function closeConfirm(result=false){$('#confirmModal').classList.add('hidden');if(state.confirmResolve){state.confirmResolve(result);state.confirmResolve=null;}}
function openCommand(){const modal=$('#commandModal');modal.classList.remove('hidden');$('#commandInput').value='';renderCommandResults('');setTimeout(()=>$('#commandInput').focus(),30);}
function closeCommand(){ $('#commandModal').classList.add('hidden'); }
function renderCommandResults(query=''){
  const q=query.toLowerCase();const items=Object.entries(routes).filter(([,r])=>!q||`${r.title} ${r.description}`.toLowerCase().includes(q));
  $('#commandResults').innerHTML=items.map(([key,r],i)=>`<button class="command-item ${i===0?'active':''}" data-command-page="${key}"><i>${icon(r.icon)}</i><span><b>${esc(r.title)}</b><small>${esc(r.description)}</small></span><kbd>↵</kbd></button>`).join('')||`<div class="empty-mini">${icon('search')}<b>No matching tools</b></div>`;
}
/* Event wiring */
$$('[data-route]').forEach((link)=>link.addEventListener('click',(event)=>{if(event.metaKey||event.ctrlKey)return;event.preventDefault();navigate(link.dataset.pageLink||'dashboard');}));
window.addEventListener('popstate',()=>navigate(pageFromPath(),false));
$('#menuToggle').addEventListener('click',()=>{$('#sidebar').classList.add('open');$('#sidebarScrim').classList.add('open');});
$('#sidebarClose').addEventListener('click',closeSidebar);$('#sidebarScrim').addEventListener('click',closeSidebar);
$('#topProfile').addEventListener('click',(event)=>{event.stopPropagation();$('#profileMenu').classList.toggle('hidden');$('#notificationMenu').classList.add('hidden');});
$('#notificationButton').addEventListener('click',(event)=>{event.stopPropagation();$('#notificationMenu').classList.toggle('hidden');$('#profileMenu').classList.add('hidden');});
document.addEventListener('click',(event)=>{if(!event.target.closest('#profileMenu,#topProfile'))$('#profileMenu').classList.add('hidden');if(!event.target.closest('#notificationMenu,#notificationButton'))$('#notificationMenu').classList.add('hidden');});
$('#logoutButton').addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST'});location.assign('/login');}catch(error){handleError(error);}});

$('#connectChannel').addEventListener('click',(event)=>connectChannel(event.currentTarget));
$('#uploadForm').addEventListener('submit',handleUploadSubmit);
$('#uploadChannel').addEventListener('change',(event)=>{loadPlaylists(event.target.value,'#uploadPlaylist');updatePreflight();});
$('#scheduleToggle').addEventListener('change',(event)=>{const on=event.target.checked;$('#scheduleField').classList.toggle('hidden',!on);if(on){$('#uploadForm [name="privacy"][value="public"]').checked=true;const min=new Date(Date.now()+16*60_000);min.setMinutes(min.getMinutes()-min.getTimezoneOffset());$('#uploadForm [name="scheduledAt"]').min=min.toISOString().slice(0,16);}updatePreflight();});
$('#uploadForm').addEventListener('input',updateCountsAndPreflight);
$('#uploadForm [name="video"]').addEventListener('change',(event)=>{const file=event.target.files[0],box=$('.selected-file');if(!file){box.classList.add('hidden');return;}box.classList.remove('hidden');box.querySelector('b').textContent=file.name;box.querySelector('small').textContent=`${formatBytes(file.size)} · ${file.type||'video'}`;updatePreflight();});
$('#uploadForm [name="thumbnail"]').addEventListener('change',(event)=>{const file=event.target.files[0];if(file){const span=$('.file-button span');span.innerHTML=`<b>${esc(file.name)}</b><small>${formatBytes(file.size)} · ready</small>`;}});
['dragenter','dragover'].forEach(type=>$('#videoDropzone').addEventListener(type,(e)=>{e.preventDefault();$('#videoDropzone').classList.add('dragover');}));
['dragleave','drop'].forEach(type=>$('#videoDropzone').addEventListener(type,(e)=>{$('#videoDropzone').classList.remove('dragover');if(type==='drop'){e.preventDefault();const file=e.dataTransfer.files[0];if(file){const dt=new DataTransfer();dt.items.add(file);$('#uploadForm [name="video"]').files=dt.files;$('#uploadForm [name="video"]').dispatchEvent(new Event('change'));}}}));
$('#uploadHistoryToggle').addEventListener('click',()=>$('#uploadHistoryPanel').classList.toggle('hidden'));
$('#refreshUploads').addEventListener('click',()=>loadUploads().catch(handleError));

$('#bulkChannel').addEventListener('change',loadBulkVideos);$('#bulkRefresh').addEventListener('click',loadBulkVideos);
$('#bulkSearch').addEventListener('input',debounce(renderBulkVideos,120));
$('#selectAllVideos').addEventListener('change',(event)=>{filteredBulkVideos().forEach(v=>event.target.checked?state.bulkSelected.add(v.id):state.bulkSelected.delete(v.id));renderBulkVideos();});
$('#openBulkPanel').addEventListener('click',()=>$('#bulkEditPanel').scrollIntoView({behavior:'smooth',block:'start'}));
$$('[data-enable]').forEach((toggle)=>toggle.addEventListener('change',()=>{const field=$(`#${toggle.dataset.enable}Field`);field.classList.toggle('disabled',!toggle.checked);field.querySelectorAll('input,textarea,select').forEach(control=>control.disabled=!toggle.checked);}));
$$('[data-enable]').forEach((toggle)=>toggle.dispatchEvent(new Event('change')));
$('#bulkEditForm').addEventListener('submit',submitBulkEdit);

$('#seoForm').addEventListener('submit',submitSeo);$('#seoForm').addEventListener('input',()=>{updateSeoCounts();saveSeoDraft();});$('#seoClear').addEventListener('click',clearSeo);
$('#copySeoTags').addEventListener('click',()=>{const tags=$$('[data-copy-tag]').map(x=>x.dataset.copyTag);if(tags.length)copyText(tags.join(', '),'Suggested tags copied.');else toast('Run an analysis first.','warning');});

$$('[data-ai-type]').forEach(button=>button.addEventListener('click',()=>selectAiType(button.dataset.aiType)));
$('#aiForm').addEventListener('submit',submitAi);$('#copyAllAi').addEventListener('click',()=>state.aiItems.length?copyText(state.aiItems.join('\n\n'),'All creative directions copied.'):toast('Generate ideas first.','warning'));
$$('[data-example]').forEach(button=>button.addEventListener('click',()=>{$('#aiForm [name="topic"]').value=button.dataset.example;$('#aiForm [name="topic"]').focus();}));

$('#thumbnailChannel').addEventListener('change',loadThumbnailVideos);$('#thumbnailSearch').addEventListener('input',debounce(renderThumbnails,120));
$('#urlAnalyzerForm').addEventListener('submit',submitUrlAnalyzer);

$$('[data-settings-tab]').forEach(button=>button.addEventListener('click',()=>{$$('[data-settings-tab]').forEach(x=>x.classList.toggle('active',x===button));$$('[data-settings-pane]').forEach(pane=>pane.classList.toggle('hidden',pane.dataset.settingsPane!==button.dataset.settingsTab));}));
$('#profileForm').addEventListener('submit',saveProfile);$('#notificationsForm').addEventListener('submit',saveNotifications);$('#passwordForm').addEventListener('submit',changePassword);$('#appearanceForm').addEventListener('submit',saveAppearance);
$('#refreshApiStatus').addEventListener('click',loadApiStatus);

$('#commandOpen').addEventListener('click',openCommand);$('#commandInput').addEventListener('input',(event)=>renderCommandResults(event.target.value));
$('#commandModal').addEventListener('click',(event)=>{if(event.target===$('#commandModal'))closeCommand();});
$$('[data-modal-close]').forEach(button=>button.addEventListener('click',()=>closeConfirm(false)));$('#confirmAction').addEventListener('click',()=>closeConfirm(true));

document.addEventListener('click',(event)=>{
  const nav=event.target.closest('[data-navigate]');if(nav){navigate(nav.dataset.navigate);return;}
  const connect=event.target.closest('[data-connect-channel]');if(connect){connectChannel(connect);return;}
  const sync=event.target.closest('[data-channel-sync]');if(sync){syncChannel(sync.dataset.channelSync,sync);return;}
  const remove=event.target.closest('[data-channel-remove]');if(remove){removeChannel(remove.dataset.channelRemove);return;}
  const retry=event.target.closest('[data-retry-upload]');if(retry){retryUpload(retry.dataset.retryUpload,retry);return;}
  const clear=event.target.closest('[data-clear-file]');if(clear){event.preventDefault();event.stopPropagation();const input=$(`#uploadForm [name="${clear.dataset.clearFile}"]`);input.value='';resetSelectedFile();updatePreflight();return;}
  const tag=event.target.closest('[data-copy-tag]');if(tag){copyText(tag.dataset.copyTag,'Tag copied.');return;}
  const ai=event.target.closest('[data-copy-ai]');if(ai){copyText(state.aiItems[Number(ai.dataset.copyAi)]||'','Direction copied.');return;}
  const command=event.target.closest('[data-command-page]');if(command){closeCommand();navigate(command.dataset.commandPage);return;}
});
document.addEventListener('change',(event)=>{
  const select=event.target.closest('[data-video-select]');if(select){select.checked?state.bulkSelected.add(select.dataset.videoSelect):state.bulkSelected.delete(select.dataset.videoSelect);renderBulkVideos();}
});
document.addEventListener('keydown',(event)=>{
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openCommand();}
  if(event.key==='Escape'){closeCommand();if(!$('#confirmModal').classList.contains('hidden'))closeConfirm(false);closeSidebar();}
  if(event.key==='Enter'&&!$('#commandModal').classList.contains('hidden')&&document.activeElement===$('#commandInput')){const first=$('.command-item','#commandResults');if(first){event.preventDefault();closeCommand();navigate(first.dataset.commandPage);}}
});
window.addEventListener('resize',debounce(()=>{if(state.dashboard){drawLineChart($('#uploadChart'),state.dashboard.uploadTimeline,'#00ff66');drawLineChart($('#analyticsChart'),state.dashboard.uploadTimeline,'#00ff66',true);}},180));

(async function init(){
  try{
    await ensureCsrf();const {user}=await api('/api/auth/me');state.user=user;applyUser();restoreSeoDraft();updateCountsAndPreflight();
    await loadChannels();navigate(pageFromPath(),false);
    const oauth=new URLSearchParams(location.search).get('oauth');
    if(oauth){const messages={success:['Channel connected securely.','success'],denied:['Google authorization was cancelled.','warning'],invalid_state:['OAuth security state was invalid. Please try again.','error'],missing_code:['Google did not return an authorization code.','error']};const [message,type]=messages[oauth]||['Channel connection could not be completed.','error'];toast(message,type);history.replaceState({},'',location.pathname);if(oauth==='success')await loadChannels();}
  }catch(error){if(error.status===401)location.assign('/login');else{handleError(error);hideLoader(100);}}
  finally{hideLoader(500);}
})();
