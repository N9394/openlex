// Theme and text size before the first paint (kept out of index.html: the
// Content-Security-Policy allows no inline scripts).
try{var t=localStorage.getItem('theme');if(t==='dark'||(t!=='light'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark');var z={s:'14px',l:'18px'}[localStorage.getItem('openlex-text-size')];if(z)document.documentElement.style.fontSize=z}catch(e){}
