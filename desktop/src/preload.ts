// 렌더러에 안전하게 노출되는 API (contextIsolation).
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('connect', {
  // 설정
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch: any) => ipcRenderer.invoke('config:set', patch),

  // 비서 엔진
  run: (text: string) => ipcRenderer.invoke('company:run', text),         // 선택된 에이전트와 1:1
  dispatch: (text: string) => ipcRenderer.invoke('company:dispatch', text), // 1인 기업 모드 (멀티에이전트)
  reset: () => ipcRenderer.invoke('company:reset'),
  listModels: () => ipcRenderer.invoke('models:list'),
  onEngineEvent: (cb: (e: any) => void) => {
    const h = (_e: any, ev: any) => cb(ev);
    ipcRenderer.on('engine:event', h);
    return () => ipcRenderer.removeListener('engine:event', h);
  },

  // 광장
  plazaEnter: () => ipcRenderer.invoke('plaza:enter'),
  plazaLeave: () => ipcRenderer.invoke('plaza:leave'),
  plazaSend: (text: string) => ipcRenderer.invoke('plaza:send', text),
  plazaTopic: (text: string) => ipcRenderer.invoke('plaza:topic', text),
  plazaDemoBot: (on: boolean) => ipcRenderer.invoke('plaza:demobot', on),
  plazaGrade: () => ipcRenderer.invoke('plaza:grade'),
  plazaDbUrl: () => ipcRenderer.invoke('plaza:dburl'),
  onPlazaPeer: (cb: (m: any) => void) => {
    const h = (_e: any, m: any) => cb(m);
    ipcRenderer.on('plaza:peer', h);
    return () => ipcRenderer.removeListener('plaza:peer', h);
  },
});
