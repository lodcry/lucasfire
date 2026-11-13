// Backend: abra o site uma vez com ?backend=https://SEU-BACKEND.onrender.com
const q = new URLSearchParams(location.search).get('backend');
if (q) localStorage.setItem('backend', q.replace(/\/$/, ''));
export const API = localStorage.getItem('backend') || 'http://localhost:3000';
export const WS_URL = API.replace(/^http/, 'ws') + '/ws';
