// ==UserScript==
// @name         ComfyUI Flow Bridge V53.11 (Mobile & Desktop)
// @namespace    http://tampermonkey.net/
// @version      53.11
// @description  ComfyUI Bridge for SillyTavern with Mobile Support & Logic Fixes
// @author       Gemini
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // index.js - V53.11 (Mobile/Desktop Responsive + Touch Canvas + Logic Fixes + Bottom Padding Fix)

    const extensionName = "comfyui-flow-bridge-v53-11";
    let comfyURL = localStorage.getItem("cf_v53_api_url") || ""; 
    let clientId = "client_" + Date.now(); 

    // --- LLM 配置 ---
    let llmSettings = {
        url: localStorage.getItem("cf_v53_llm_url") || "https://api.openai.com/v1",
        key: localStorage.getItem("cf_v53_llm_key") || "",
        model: localStorage.getItem("cf_v53_llm_model") || "gpt-3.5-turbo",
        systemPrompt: localStorage.getItem("cf_v53_llm_sys") || "你是一位 Stable Diffusion 提示词专家..."
    };

    // --- 自动执行配置 ---
    let autoGenEnabled = localStorage.getItem("cf_v53_auto_gen") === "true";
    // --- 随机种子配置 ---
    let randomSeedEnabled = localStorage.getItem("cf_v53_random_seed") === "true";

    // --- 临时定位存储 ---
    let tempLocators = {}; 

    // --- 系统预设数据 ---
    let presets = { jailbreak: [], task: [], char: [] };
    function initPresetsData() {
        try {
            presets.jailbreak = JSON.parse(localStorage.getItem("cf_v53_jailbreak") || "[]");
            presets.task = JSON.parse(localStorage.getItem("cf_v53_task") || "[]");
            presets.char = JSON.parse(localStorage.getItem("cf_v53_char") || "[]");
            presets.char.forEach(c => { if(!c.history) c.history = []; });
        } catch (e) { presets = { jailbreak: [], task: [], char: [] }; }
    }
    initPresetsData();

    // --- 动态提示词面板 ---
    let promptPanels = JSON.parse(localStorage.getItem("cf_v53_prompt_panels") || "[]");
    if (promptPanels.length === 0) {
        promptPanels.push({ id: 'default_pos', type: 'positive', name: '正面提示词 (Main)', text: '', prefix: '', suffix: '', nodeId: '', widgetId: '', savedStates: [] });
        promptPanels.push({ id: 'default_neg', type: 'negative', name: '负面提示词 (Main)', text: '', nodeId: '', widgetId: '', savedStates: [] });
    } else {
        promptPanels.forEach(p => { if (!p.savedStates) p.savedStates = []; });
    }

    // --- 画廊数据 ---
    let galleryData = [];
    try {
        galleryData = JSON.parse(localStorage.getItem("cf_v53_gallery") || "[]");
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        galleryData = galleryData.filter(item => (now - item.timestamp) < oneDay);
        localStorage.setItem("cf_v53_gallery", JSON.stringify(galleryData));
    } catch (e) { galleryData = []; }

    let resourceCache = { loras: [], embeddings: [] };
    let apiWorkflow = null;      
    let visualWorkflow = null;   
    let nodeDefinitions = {};    
    let socketCache = {};        
    let currentApiName = localStorage.getItem("cf_v53_api_name") || "未加载";
    let currentVisName = localStorage.getItem("cf_v53_vis_name") || "未加载";
    let capturedContext = ""; 
    let socket = null; 
    let clickTimer = null; 
    let currentOpeningImgId = null; 
    let restoreObserver = null; 

    let apiPresets = JSON.parse(localStorage.getItem("cf_v53_api_presets") || "[]");
    let visPresets = JSON.parse(localStorage.getItem("cf_v53_vis_presets") || "[]");
    let canvasState = { scale: 1, x: 0, y: 0, isPanning: false, isDraggingNode: false, draggedNodeId: null, lastX: 0, lastY: 0, zIndexCounter: 100 };

    // ----------------------------------------
    // 0. 样式注入
    // ----------------------------------------
    function cleanupOldVersion() {
        const oldMask = document.getElementById("cf-mask"); if(oldMask) oldMask.remove();
        const oldGallery = document.getElementById("cf-gallery"); if(oldGallery) oldGallery.remove();
        const oldStyle = document.getElementById("comfyui-v53-style"); if(oldStyle) oldStyle.remove();
        const oldToast = document.getElementById("cf-toast"); if(oldToast) oldToast.remove();
        document.querySelectorAll('.cf-inject-wrapper').forEach(wrapper => {
            if (!wrapper.querySelector('.cf-result-img')) wrapper.remove();
        });
        if(restoreObserver) restoreObserver.disconnect();
    }
    cleanupOldVersion();

    function injectStyles() {
        const styleId = "comfyui-v53-style";
        if (document.getElementById(styleId)) return;
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
            #cf-mask { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.95); z-index: 999999; display: none; align-items: center; justify-content: center; backdrop-filter: blur(5px); }
            #cf-mask.show { display: flex; }
            #cf-panel { background: #121212; width: 95vw; height: 95vh; border: 1px solid #333; border-radius: 8px; display: flex; flex-direction: column; color: #ddd; font-family: "Microsoft YaHei", sans-serif; box-shadow: 0 0 50px rgba(0,0,0,1); max-width: 1920px; }
            
            #cf-gallery { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.98); z-index: 1000000; display: none; flex-direction: column; color: #fff; user-select: none; }
            #cf-gallery.show { display: flex; }
            .cf-gallery-head { padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.5); border-bottom: 1px solid #333; }
            .cf-gallery-main { flex: 1; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; }
            .cf-gallery-img { max-width: 95%; max-height: 95%; object-fit: contain; box-shadow: 0 0 30px rgba(0,0,0,0.8); border: 2px solid #333; border-radius: 4px; transition: transform 0.2s; }
            .cf-gallery-nav { position: absolute; top: 50%; transform: translateY(-50%); font-size: 40px; color: rgba(255,255,255,0.5); cursor: pointer; padding: 20px; transition: 0.2s; background: rgba(0,0,0,0.2); border-radius: 50%; width: 50px; height: 50px; display:flex; align-items:center; justify-content:center; }
            .cf-gallery-nav:hover { color: #fff; background: rgba(255,255,255,0.1); }
            .cf-gallery-prev { left: 20px; } .cf-gallery-next { right: 20px; }
            .cf-gallery-foot { height: 100px; background: rgba(0,0,0,0.8); display: flex; align-items: center; gap: 10px; padding: 0 20px; overflow-x: auto; border-top: 1px solid #333; }
            .cf-thumb { height: 70px; width: 70px; object-fit: cover; border-radius: 4px; opacity: 0.5; cursor: pointer; border: 2px solid transparent; flex-shrink: 0; }
            .cf-thumb.active { opacity: 1; border-color: #339af0; transform: scale(1.05); }
            .cf-gallery-info { position: absolute; bottom: 120px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.7); padding: 5px 15px; border-radius: 20px; font-size: 12px; color: #aaa; pointer-events: none; }

            .cf-head { padding: 12px 20px; background: #1f1f1f; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center; font-size: 15px; font-weight: 600; flex-shrink: 0; }
            .cf-status-dot { width:10px; height:10px; border-radius:50%; background:#2f9e44; display:inline-block; margin-right:8px; box-shadow: 0 0 6px #2f9e44; }
            .cf-tabs { display: flex; background: #181818; border-bottom: 1px solid #333; flex-shrink: 0;}
            .cf-tab { flex: 1; text-align: center; padding: 12px 0; cursor: pointer; font-size: 13px; color: #666; transition:0.2s; border-bottom: 3px solid transparent; }
            .cf-tab.active { color: #fff; background: #222; border-bottom: 3px solid #d6336c; font-weight: bold; }
            .cf-body { flex: 1; overflow: hidden; position: relative; display: flex; flex-direction: column; background: #0f0f0f; } 
            .cf-view { display: none; flex-direction: column; width: 100%; height: 100%; }
            .cf-view.active { display: flex; }
            .cf-inp, .cf-sel { background: #1a1a1a; border: 1px solid #333; color: #ccc; padding: 8px; border-radius: 4px; font-size: 13px; outline: none; width: 100%; box-sizing: border-box; transition: 0.2s; }
            .cf-inp:focus, .cf-sel:focus { border-color: #666; background: #000; }
            .cf-btn { padding: 8px 16px; border-radius: 4px; border: none; cursor: pointer; color: white; background: #333; font-size: 12px; transition: 0.2s; font-weight: bold; display:inline-flex; align-items:center; justify-content:center; gap:6px; }
            .cf-btn:hover { filter: brightness(1.2); }
            .cf-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            .cf-btn.blue { background: #1971c2; }
            .cf-btn.red { background: #c92a2a; }
            .cf-btn.green { background: #2f9e44; }
            .cf-btn.purple { background: #8e44ad; }
            .cf-btn.orange { background: #e67700; }
            .cf-btn.gray { background: #444; color: #aaa; } 
            
            /* 修改部分：增加了 padding-bottom: 150px 以适应手机遮挡 */
            .cf-scroll-y { overflow-y: auto; padding: 20px; padding-bottom: 150px !important; box-sizing: border-box; }
            
            .cf-group { background: #1a1a1a; padding: 15px; border-radius: 6px; border: 1px solid #333; margin-bottom: 15px; }
            .cf-label { color: #aaa; font-size: 12px; margin-bottom: 6px; display:block; }
            .cf-status-label { font-size: 11px; color: #22b8cf; margin-left: 8px; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(34, 184, 207, 0.3); }

            .cf-panel-box { border: 1px solid #333; background: #1e1e1e; border-radius: 6px; margin-bottom: 15px; overflow: hidden; }
            .cf-panel-head { padding: 8px 12px; background: #252525; display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: bold; border-bottom: 1px solid #333; }
            .cf-panel-body { padding: 12px; }
            .cf-panel-type-positive { border-left: 3px solid #339af0; }
            .cf-panel-type-negative { border-left: 3px solid #ff6b6b; }
            .cf-panel-type-custom { border-left: 3px solid #fcc419; }
            .cf-panel-presets-area { background: #151515; padding: 8px; margin-bottom: 10px; border-radius: 4px; border: 1px dashed #444; }

            .cf-preset-section-head { font-size: 13px; font-weight: bold; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 5px; }
            .cf-preset-edit-area { background: #252525; padding: 10px; border-radius: 4px; margin-bottom: 10px; border: 1px solid #333; }
            .cf-preset-list { max-height: 150px; overflow-y: auto; background: #151515; border: 1px solid #333; border-radius: 4px; }
            .cf-preset-item { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid #222; font-size: 12px; cursor: pointer; transition: 0.2s; }
            .cf-preset-item:hover { background: #222; }
            .cf-preset-item.active { background: #1e3a29; border-left: 3px solid #2f9e44; }

            .cf-dynamic-card { border: 1px solid #444; border-radius: 6px; background: #202020; margin-bottom: 15px; overflow: hidden; animation: cf-fade-in 0.3s ease; }
            .cf-card-header { padding: 8px 12px; font-size: 12px; font-weight: bold; color: #ddd; display: flex; justify-content: space-between; align-items: center; }
            .cf-card-role .cf-card-header { background: #1864ab; }
            .cf-card-data .cf-card-header { background: #d6336c; }
            .cf-card-body { padding: 10px; }
            .cf-card-meta { font-size: 11px; color: #aaa; background: rgba(0,0,0,0.3); padding: 4px 8px; margin-bottom: 8px; border-radius: 4px; border-left: 2px solid #aaa; display: flex; gap: 6px; align-items: center; }
            
            .cf-inject-wrapper { display: inline-block; vertical-align: baseline; margin-left: 4px; }
            .cf-inject-btn {
                display: inline-flex; align-items: center; gap: 5px;
                background: linear-gradient(90deg, #1864ab, #339af0);
                color: white; border: none; padding: 2px 8px;
                border-radius: 10px; font-size: 10px; font-weight: bold;
                cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.3); 
                transition: transform 0.2s; font-family: sans-serif;
                text-shadow: 0 1px 2px rgba(0,0,0,0.5); pointer-events: auto;
                line-height: 1.2;
            }
            .cf-inject-btn:hover { transform: scale(1.05); filter: brightness(1.1); }
            .cf-inject-btn.loading { background: #c92a2a; cursor: pointer; animation: cf-pulse 2s infinite; }
            
            @keyframes cf-pulse { 0% { opacity: 1; } 50% { opacity: 0.8; } 100% { opacity: 1; } }

            .cf-result-img { 
                max-width: 300px; max-height: 300px; border-radius: 8px; 
                border: 2px solid #339af0; box-shadow: 0 4px 15px rgba(0,0,0,0.5); 
                display: block; margin-top: 5px; animation: cf-fade-in 0.5s; cursor: pointer;
            }
            .cf-result-img:hover { filter: brightness(1.1); border-color: #fff; }

            @keyframes cf-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            #cf-toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #2f9e44; color: white; padding: 10px 20px; border-radius: 20px; font-size: 14px; font-weight: bold; z-index: 1000000; box-shadow: 0 4px 10px rgba(0,0,0,0.3); opacity: 0; transition: opacity 0.3s; pointer-events: none; }
            #cf-toast.show { opacity: 1; top: 30px; }

            #cf-canvas-viewport { width: 100%; height: 100%; background: #080808; overflow: hidden; position: relative; cursor: grab; background-image: radial-gradient(#333 1px, transparent 1px); background-size: 20px 20px; }
            #cf-canvas-world { position: absolute; top: 0; left: 0; transform-origin: 0 0; will-change: transform; }
            .cf-canvas-node { position: absolute; background: rgba(35,35,35,0.95); border-radius: 6px; box-shadow: 0 6px 15px rgba(0,0,0,0.6); min-width: 220px; display: flex; flex-direction: column; border: 1px solid #444; font-size: 12px; user-select: none; }
            .cf-canvas-node-head { background: #2d2d2d; color: #eee; padding: 6px 10px; font-size: 12px; font-weight: bold; border-top-left-radius: 6px; border-top-right-radius: 6px; cursor: grab; display: flex; justify-content: space-between; border-bottom: 1px solid #333; }
            .cf-canvas-node-body { padding: 6px 0; display: flex; flex-direction: column; gap: 4px; }
            .cf-node-row { display: flex; align-items: center; position: relative; padding: 3px 10px; min-height: 20px; justify-content: space-between; gap: 10px; }
            .cf-socket-handle { width: 10px; height: 10px; border-radius: 50%; background: #777; border: 2px solid #1e1e1e; flex-shrink: 0; cursor: crosshair; }
            .cf-row-in { justify-content: flex-start; } .cf-row-in .cf-socket-handle { margin-right: 8px; margin-left: -16px; } 
            .cf-row-out { justify-content: flex-end; } .cf-row-out .cf-socket-handle { margin-left: 8px; margin-right: -16px; }
            .cf-widget-row { display: flex; align-items: center; justify-content: space-between; padding: 3px 10px; gap: 8px; }
            .cf-widget-label { color: #999; font-size: 11px; flex-shrink: 0; }
            .cf-mini-btn { background: #333; border: none; color: #ccc; width: 18px; height: 18px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 10px; flex-shrink: 0; }
            .cf-preview-box { padding: 5px; text-align: center; background: #000; margin: 5px; }
            .cf-preview-img { max-width: 100%; max-height: 140px; display: block; margin: 0 auto; object-fit: contain; }
            #cf-canvas-links { position: absolute; top: 0; left: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; z-index: -1; }
            .cf-link-path { fill: none; stroke-width: 2px; opacity: 0.6; stroke-linecap: round; }
            .cf-canvas-group { position: absolute; border-radius: 6px; font-size: 24px; font-weight: bold; color: rgba(255,255,255,0.1); display: flex; align-items: flex-end; justify-content: center; pointer-events: none; background: rgba(255,255,255,0.02); border: 2px dashed rgba(255,255,255,0.05); padding-bottom: 10px;}
            
            .cf-checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #ccc; cursor: pointer; user-select: none; }
            .cf-checkbox-label input { accent-color: #339af0; cursor: pointer; }

            /* V53.11 Mobile Responsive Overrides */
            @media screen and (max-width: 768px) {
                #cf-panel { width: 100vw !important; height: 100vh !important; border-radius: 0 !important; top: 0 !important; left: 0 !important; }
                .cf-btn { padding: 12px 20px; font-size: 14px; } /* Bigger touch targets */
                .cf-inp, .cf-sel { font-size: 16px; padding: 10px; } /* Prevent zoom, easier tap */
                .cf-head { padding: 15px; }
                .cf-tabs { overflow-x: auto; justify-content: flex-start; -webkit-overflow-scrolling: touch; }
                .cf-tab { flex: none; width: auto; padding: 12px 20px; white-space: nowrap; }
                
                /* Stack layouts for mobile */
                #view-llm .cf-group > div[style*="display:flex"] { flex-direction: column !important; gap: 10px !important; }
                #cf-llm-url, #cf-llm-key { width: 100% !important; margin: 0 !important; }
                .cf-panel-body > div[style*="display:flex"] { flex-direction: column !important; }
                
                /* Bigger Canvas Handles */
                .cf-socket-handle { width: 16px; height: 16px; margin-left: -8px; margin-right: -8px; }
            }
        `;
        document.head.appendChild(style);
    }

    // ----------------------------------------
    // 1. 系统初始化
    // ----------------------------------------
    function initSystem() {
        createModal();
        createGalleryModal();
        createToast();
        initMagicWandTrigger(); 
        updateSystemPromptPreview();
        
        initPersistenceObserver();

        setInterval(checkSidebarButton, 1000);
        
        const savedApi = localStorage.getItem("cf_v53_api_json");
        const savedVis = localStorage.getItem("cf_v53_visual_json");
        if(savedApi) parseApiJson(savedApi, false);
        if(savedVis) parseVisualJson(savedVis, false);
        
        renderPromptPanels();
        initWebSocket(); 
    }

    // V53.3: 持久化核心修复
    function initPersistenceObserver() {
        if (restoreObserver) return;
        let restoreTimer = null;
        
        // 立即执行一次
        restoreGalleryImages();
        
        restoreObserver = new MutationObserver((mutations) => {
            if(restoreTimer) clearTimeout(restoreTimer);
            restoreTimer = setTimeout(() => {
                restoreGalleryImages();
            }, 800);
        });
        
        restoreObserver.observe(document.body, { childList: true, subtree: true });
    }

    function checkSidebarButton() {
        const genBtns = document.querySelectorAll(".list-group-item");
        genBtns.forEach(el => {
            if (el.innerText && (el.innerText.includes("生成图片") || el.innerText.includes("Generate Image"))) {
                if (!el.parentElement.querySelector("#cf-bridge-btn")) {
                    const btn = document.createElement("div");
                    btn.id = "cf-bridge-btn";
                    btn.className = "list-group-item"; 
                    btn.style.cursor = "pointer"; btn.style.display = "flex"; btn.style.alignItems = "center";
                    btn.innerHTML = `<span class="fa-solid fa-bolt" style="margin-right:0.5rem; opacity:0.8;"></span><span>ComfyUI</span>`;
                    btn.onclick = (e) => { e.stopPropagation(); window.openPanel(); };
                    el.parentElement.insertBefore(btn, el);
                }
            }
        });
    }

    window.openPanel = function() {
        const m = document.getElementById("cf-mask");
        if(m) m.classList.add("show");
    }

    function createToast() {
        if(document.getElementById("cf-toast")) return;
        const t = document.createElement("div"); t.id = "cf-toast"; document.body.appendChild(t);
    }
    function showToast(msg) {
        const t = document.getElementById("cf-toast"); t.innerText = msg; t.classList.add("show");
        setTimeout(() => t.classList.remove("show"), 2000);
    }

    function initMagicWandTrigger() {
        document.body.addEventListener('dblclick', (e) => {
            const target = e.target;
            const isMagic = target.closest('.fa-wand-magic-sparkles') || 
                            target.closest('.fa-magic') || 
                            target.closest('[class*="magic"]') || 
                            target.closest('[class*="wand"]');
            
            if (isMagic) {
                e.preventDefault(); 
                e.stopPropagation();
                captureLastTwoMessages();
            }
        }, { capture: true }); 
    }

    // V53.10: 终极净化逻辑 - 同时清除 DOM 和 后台关联
    function purgeContextUI() {
        const messages = document.querySelectorAll('.mes_text');
        if (messages.length === 0) return;
        const lastTwo = Array.from(messages).slice(-2);
        
        let galleryUpdated = false;
        lastTwo.forEach(msg => {
            const text = msg.innerText; 
            galleryData.forEach(item => {
                if (item.locator && text.includes(item.locator)) {
                    item.locator = null; 
                    galleryUpdated = true;
                }
            });
        });

        if (galleryUpdated) {
            localStorage.setItem("cf_v53_gallery", JSON.stringify(galleryData));
        }

        let cleanedCount = 0;
        lastTwo.forEach(msg => {
            const injects = msg.querySelectorAll('.cf-inject-wrapper, .cf-result-img');
            injects.forEach(el => {
                el.remove();
                cleanedCount++;
            });
        });
        
        if (cleanedCount > 0 || galleryUpdated) {
            showToast(`🧹 已彻底清理 ${cleanedCount} 个元素`);
        }
    }

    function captureLastTwoMessages() {
        const messages = document.querySelectorAll('.mes_text');
        if (messages.length === 0) return showToast("⚠️ 未找到聊天记录");
        
        const lastTwo = Array.from(messages).slice(-2);
        
        const contextText = lastTwo.map(el => {
            const clone = el.cloneNode(true);
            clone.querySelectorAll('.cf-inject-wrapper, .cf-result-img, button').forEach(n => n.remove());
            return clone.innerText.trim();
        }).filter(t => t).join("\n\n---\n\n");

        capturedContext = contextText;
        const inputEl = document.getElementById("cf-test-user-input");
        if(inputEl) {
            inputEl.value = contextText;
            inputEl.style.borderColor = "#fcc419"; 
            setTimeout(() => inputEl.style.borderColor = "#333", 500);
        }

        purgeContextUI();

        showToast("✨ 上下文已提取 & 界面已深度净化");
        window.generatePromptTest();
    }

    // ----------------------------------------
    // 2. 备份与还原 & WebSocket & Gallery Logic
    // ----------------------------------------
    function initWebSocket() {
        if(!comfyURL) return;
        let wsUrl = comfyURL.replace("http://", "ws://").replace("https://", "wss://");
        wsUrl = wsUrl.replace(/\/$/, "") + "/ws?clientId=" + clientId;
        if(socket) socket.close();
        socket = new WebSocket(wsUrl);
        socket.onopen = () => console.log("ComfyBridge: WS Connected");
        socket.onerror = (e) => console.log("ComfyBridge: WS Error", e);
        socket.onmessage = async (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'execution_success') {
                    const promptId = msg.data.prompt_id;
                    await handleExecutionSuccess(promptId);
                }
            } catch(e) {}
        };
    }

    async function handleExecutionSuccess(promptId) {
        const waitingBtn = document.querySelector(`.cf-inject-btn[data-prompt-id="${promptId}"]`);
        if (!waitingBtn) return;
        
        waitingBtn.innerHTML = `<span class="fa-solid fa-check"></span> 获取图片...`;
        try {
            const res = await fetch(`${comfyURL}/history/${promptId}`);
            const data = await res.json();
            const outputs = data[promptId].outputs;
            let imgFilename = null; let imgSubfolder = ""; let imgType = "";
            for (const nodeId in outputs) {
                if (outputs[nodeId].images && outputs[nodeId].images.length > 0) {
                    const imgData = outputs[nodeId].images[0];
                    imgFilename = imgData.filename; imgSubfolder = imgData.subfolder; imgType = imgData.type;
                    break;
                }
            }
            if (imgFilename) {
                let src = `${comfyURL}/view?filename=${imgFilename}&type=${imgType}`;
                if(imgSubfolder) src += `&subfolder=${imgSubfolder}`;
                
                const posPanel = promptPanels.find(p => p.type === 'positive');
                const promptText = posPanel ? posPanel.text : "Unknown Prompt";
                
                const btnId = waitingBtn.id;
                const locator = tempLocators[btnId] || null;

                const galleryItem = {
                    id: `gal-${Date.now()}-${Math.floor(Math.random()*10000)}`,
                    url: src,
                    prompt: promptText,
                    timestamp: Date.now(),
                    filename: imgFilename,
                    locator: locator 
                };
                galleryData.unshift(galleryItem); 
                localStorage.setItem("cf_v53_gallery", JSON.stringify(galleryData));

                const imgId = `chat-img-${promptId}`;
                const wrapper = waitingBtn.parentElement;
                
                wrapper.innerHTML = `<img id="${imgId}" src="${src}" class="cf-result-img" 
                    data-prompt="${encodeURIComponent(galleryItem.prompt)}"
                    data-gal-id="${galleryItem.id}"
                    onclick="window.handleImageClick('${imgId}', '${galleryItem.id}')"
                    ondblclick="window.handleImageDblClick(this)"
                >`;
                showToast("✅ 图片已生成并归档");
                
                if(btnId) delete tempLocators[btnId];

            } else { waitingBtn.innerHTML = "❌ 未找到图片"; waitingBtn.classList.remove("loading"); }
        } catch(e) { console.error(e); waitingBtn.innerHTML = "❌ 错误"; }
    }

    function restoreGalleryImages() {
        if (galleryData.length === 0) return;
        const processedLocators = new Set();

        galleryData.forEach(item => {
            if (!item.locator || processedLocators.has(item.locator)) return;
            
            const messages = document.querySelectorAll('.mes_text');
            for (let i = messages.length - 1; i >= 0; i--) {
                const messageEl = messages[i];
                
                if (messageEl.innerText.includes(item.locator)) {
                    if (messageEl.innerHTML.includes(item.url) || messageEl.querySelector(`img[src="${item.url}"]`)) {
                        processedLocators.add(item.locator);
                        break; 
                    }

                    const imgId = `restored-${item.id}`;
                    const wrapper = document.createElement("span");
                    wrapper.className = "cf-inject-wrapper";
                    wrapper.innerHTML = `<img id="${imgId}" src="${item.url}" class="cf-result-img" 
                        data-prompt="${encodeURIComponent(item.prompt)}"
                        data-gal-id="${item.id}"
                        onclick="window.handleImageClick('${imgId}', '${item.id}')"
                        ondblclick="window.handleImageDblClick(this)"
                    >`;
                    
                    if (injectNodeAfterText(messageEl, item.locator, wrapper)) {
                        processedLocators.add(item.locator);
                        break;
                    }
                }
            }
        });
    }

    window.handleImageClick = function(domId, galleryId) {
        if(clickTimer) clearTimeout(clickTimer);
        clickTimer = setTimeout(() => {
            openGallery(galleryId, domId);
        }, 250); 
    }

    window.handleImageDblClick = function(imgEl) {
        if(clickTimer) clearTimeout(clickTimer);
        
        if (!imgEl) return;
        const promptEncoded = imgEl.dataset.prompt;
        const galId = imgEl.dataset.galId; // 获取画廊 ID
        const promptText = decodeURIComponent(promptEncoded);
        
        const oldItem = galleryData.find(i => i.id === galId);
        let originalLocator = null;
        if (oldItem) {
            originalLocator = oldItem.locator;
            oldItem.locator = null; // 标记废弃
            localStorage.setItem("cf_v53_gallery", JSON.stringify(galleryData)); 
        }

        const wrapper = imgEl.closest('.cf-inject-wrapper') || imgEl.parentElement;
        wrapper.innerHTML = ""; 
        
        const posPanel = promptPanels.find(p => p.type === 'positive');
        if(posPanel) {
            posPanel.text = promptText;
            savePanels();
            const el = document.getElementById(`cf-text-${posPanel.id}`);
            if(el) el.value = promptText;
        }
        
        showToast("🚀 开始重绘 (旧图已移除)...");
        
        const newBtnId = `redraw-${Date.now()}`;
        const safePrompt = promptText.replace(/"/g, '&quot;').replace(/'/g, "\\'");
        wrapper.innerHTML = `<button id="${newBtnId}" class="cf-inject-btn loading" 
            onclick="window.handleInjectedClick(event, '${newBtnId}', '${safePrompt}')">
            <span class="fa-solid fa-spinner fa-spin"></span> 重绘中...</button>`;
        
        if(originalLocator) {
            tempLocators[newBtnId] = originalLocator;
        }
        
        setTimeout(() => runWorkflow(newBtnId), 50);
    }

    // ----------------------------------------
    // V52: 画廊 UI 构建与逻辑
    // ----------------------------------------
    function createGalleryModal() {
        if(document.getElementById("cf-gallery")) return;
        const div = document.createElement("div");
        div.id = "cf-gallery";
        div.innerHTML = `
            <div class="cf-gallery-head">
                <div style="font-weight:bold; font-size:16px;">🕰️ 时光画廊 <span style="font-size:12px; color:#aaa; font-weight:normal;">(24h)</span></div>
                <div style="display:flex; gap:10px;">
                    <button class="cf-btn blue" onclick="window.downloadCurrentGalleryImage()"><span class="fa-solid fa-download"></span></button>
                    <button class="cf-btn red" onclick="window.deleteCurrentGalleryImage()"><span class="fa-solid fa-trash"></span></button>
                    <button class="cf-btn" onclick="window.closeGallery()">X</button>
                </div>
            </div>
            <div class="cf-gallery-main">
                <div class="cf-gallery-nav cf-gallery-prev" onclick="window.navGallery(-1)">&#10094;</div>
                <img id="cf-gallery-view" class="cf-gallery-img" src="">
                <div class="cf-gallery-nav cf-gallery-next" onclick="window.navGallery(1)">&#10095;</div>
                <div id="cf-gallery-info" class="cf-gallery-info"></div>
            </div>
            <div id="cf-gallery-thumbs" class="cf-gallery-foot"></div>
        `;
        document.body.appendChild(div);
    }

    let currentGalleryIndex = 0;

    window.openGallery = function(targetId, originDomId) {
        try { galleryData = JSON.parse(localStorage.getItem("cf_v53_gallery") || "[]"); } catch(e){}
        
        if(galleryData.length === 0) return showToast("📭 画廊为空");

        currentOpeningImgId = originDomId; 

        let idx = galleryData.findIndex(item => item.id === targetId);
        if(idx === -1) idx = 0; 
        currentGalleryIndex = idx;

        renderGalleryView();
        renderGalleryThumbs();
        document.getElementById("cf-gallery").classList.add("show");
    }

    window.closeGallery = function() {
        document.getElementById("cf-gallery").classList.remove("show");
        
        if (currentOpeningImgId && galleryData[currentGalleryIndex]) {
            const originImg = document.getElementById(currentOpeningImgId);
            if (originImg) {
                const currentItem = galleryData[currentGalleryIndex];
                originImg.src = currentItem.url;
                originImg.setAttribute("data-prompt", encodeURIComponent(currentItem.prompt));
                originImg.setAttribute("data-gal-id", currentItem.id); 
                originImg.setAttribute("onclick", `window.handleImageClick('${currentOpeningImgId}', '${currentItem.id}')`);
                originImg.setAttribute("ondblclick", `window.handleImageDblClick(this)`); 
                showToast("🖼️ 图片已替换为当前浏览项");
            }
        }
        currentOpeningImgId = null;
    }

    window.navGallery = function(dir) {
        if(galleryData.length === 0) return;
        currentGalleryIndex += dir;
        if (currentGalleryIndex < 0) currentGalleryIndex = galleryData.length - 1;
        if (currentGalleryIndex >= galleryData.length) currentGalleryIndex = 0;
        renderGalleryView();
        const activeThumb = document.getElementById(`thumb-${currentGalleryIndex}`);
        if(activeThumb) activeThumb.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }

    window.selectGalleryItem = function(index) {
        currentGalleryIndex = index;
        renderGalleryView();
    }

    function renderGalleryView() {
        if(galleryData.length === 0) {
            document.getElementById("cf-gallery-view").src = "";
            document.getElementById("cf-gallery-info").innerText = "No Images";
            return;
        }
        const item = galleryData[currentGalleryIndex];
        document.getElementById("cf-gallery-view").src = item.url;
        
        const date = new Date(item.timestamp);
        const timeStr = `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
        document.getElementById("cf-gallery-info").innerText = `[${currentGalleryIndex + 1} / ${galleryData.length}] ${timeStr} - ${item.prompt.substring(0, 30)}...`;

        document.querySelectorAll(".cf-thumb").forEach(el => el.classList.remove("active"));
        const t = document.getElementById(`thumb-${currentGalleryIndex}`);
        if(t) t.classList.add("active");
    }

    function renderGalleryThumbs() {
        const c = document.getElementById("cf-gallery-thumbs");
        c.innerHTML = "";
        galleryData.forEach((item, idx) => {
            c.innerHTML += `<img id="thumb-${idx}" src="${item.url}" class="cf-thumb" onclick="window.selectGalleryItem(${idx})">`;
        });
    }

    window.downloadCurrentGalleryImage = function() {
        if(galleryData.length === 0) return;
        const item = galleryData[currentGalleryIndex];
        const a = document.createElement("a");
        a.href = item.url;
        a.download = item.filename || `image_${item.id}.png`;
        a.click();
    }

    window.deleteCurrentGalleryImage = function() {
        if(galleryData.length === 0) return;
        if(!confirm("确认从缓存删除此图片？")) return;
        
        galleryData.splice(currentGalleryIndex, 1);
        localStorage.setItem("cf_v53_gallery", JSON.stringify(galleryData));
        
        if(currentGalleryIndex >= galleryData.length) currentGalleryIndex = galleryData.length - 1;
        if(currentGalleryIndex < 0) currentGalleryIndex = 0;
        
        if(galleryData.length === 0) {
            closeGallery();
            showToast("🗑️ 画廊已清空");
        } else {
            renderGalleryView();
            renderGalleryThumbs();
        }
    }


    window.exportBackup = function() {
        const backupData = {
            version: "V53.11",
            timestamp: Date.now(),
            presets: presets,
            promptPanels: promptPanels,
            apiPresets: apiPresets,
            visPresets: visPresets,
            currentApiJson: localStorage.getItem("cf_v53_api_json") || null,
            currentVisJson: localStorage.getItem("cf_v53_visual_json") || null,
            currentApiName: currentApiName,
            currentVisName: currentVisName
        };
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `ComfyBridge_Backup_${new Date().toISOString().slice(0,10)}.json`; a.click();
        URL.revokeObjectURL(url);
        showToast("📦 数据已打包下载");
    }

    window.handleBackupImport = function(input) {
        const file = input.files[0]; if(!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if(!confirm(`确认导入备份？\n(注意: 当前数据将被覆盖，网络设置不会改变)`)) return;
                presets = data.presets || { jailbreak: [], task: [], char: [] };
                promptPanels = data.promptPanels || [];
                apiPresets = data.apiPresets || [];
                visPresets = data.visPresets || [];
                currentApiName = data.currentApiName || "未加载";
                currentVisName = data.currentVisName || "未加载";
                localStorage.setItem("cf_v53_jailbreak", JSON.stringify(presets.jailbreak));
                localStorage.setItem("cf_v53_task", JSON.stringify(presets.task));
                localStorage.setItem("cf_v53_char", JSON.stringify(presets.char));
                localStorage.setItem("cf_v53_prompt_panels", JSON.stringify(promptPanels));
                localStorage.setItem("cf_v53_api_presets", JSON.stringify(apiPresets));
                localStorage.setItem("cf_v53_vis_presets", JSON.stringify(visPresets));
                localStorage.setItem("cf_v53_api_name", currentApiName);
                localStorage.setItem("cf_v53_vis_name", currentVisName);
                if(data.currentApiJson) parseApiJson(data.currentApiJson, true); else clearApiData();
                if(data.currentVisJson) parseVisualJson(data.currentVisJson, true); else clearVisData();
                renderPromptPanels(); renderPresetList('jailbreak'); renderPresetList('task'); renderPresetList('char'); renderPresets('api'); renderPresets('vis'); updateSystemPromptPreview();
                showToast("✅ 备份已成功恢复");
            } catch(err) { alert("导入失败: " + err.message); }
        };
        reader.readAsText(file); input.value = "";
    }

    // ----------------------------------------
    // 3. UI 构建
    // ----------------------------------------
    function createModal() {
        if(document.getElementById("cf-mask")) return;
        const div = document.createElement("div");
        div.id = "cf-mask";
        div.innerHTML = `
            <div id="cf-panel">
                <div class="cf-head">
                    <div style="display:flex;align-items:center;">
                        <span class="cf-status-dot"></span>
                        <span>Comfy Bridge</span>
                    </div>
                    <div style="display:flex; gap:15px;">
                        <button class="cf-btn blue" id="cf-run-btn">🚀 立即生成</button>
                        <span style="font-size:24px; cursor:pointer; line-height:1;" onclick="document.getElementById('cf-mask').classList.remove('show')">&times;</span>
                    </div>
                </div>
                
                <div class="cf-tabs">
                    <div class="cf-tab active" onclick="switchTab('visual', this)">1. 可视化面板 (Nodes)</div>
                    <div class="cf-tab" onclick="switchTab('setup', this)">2. 数据与预设 (Files)</div>
                    <div class="cf-tab" onclick="switchTab('prompts', this)">3. 提示词 (Prompt)</div>
                    <div class="cf-tab" onclick="switchTab('llm', this)">4. 第二大脑 (LLM API)</div>
                </div>

                <div class="cf-body">
                    <div id="view-visual" class="cf-view active" style="overflow:hidden;">
                        <div id="cf-canvas-viewport">
                            <div id="cf-canvas-world"><div id="cf-canvas-groups"></div><svg id="cf-canvas-links"></svg><div id="cf-canvas-nodes"></div></div>
                        </div>
                    </div>

                    <div id="view-setup" class="cf-view cf-scroll-y">
                        <div class="cf-group" style="border-color:#be4bdb;">
                            <h3 style="color:#e599f7; font-size:15px; margin-bottom:10px;">📦 全局备份/恢复 (Global Backup)</h3>
                            <div style="display:flex; gap:10px;">
                                <button class="cf-btn purple" style="flex:1; padding:10px;" onclick="window.exportBackup()">
                                    <span class="fa-solid fa-download"></span> 一键打包 (Export)
                                </button>
                                <input type="file" id="cf-backup-import" style="display:none" accept=".json" onchange="window.handleBackupImport(this)">
                                <label for="cf-backup-import" class="cf-btn orange" style="flex:1; padding:10px; display:flex; justify-content:center; align-items:center;">
                                    <span class="fa-solid fa-upload"></span> 一键导入 (Import)
                                </label>
                            </div>
                            <div style="font-size:11px; color:#666; margin-top:5px; text-align:center;">* 仅备份预设、面板与工作流，不包含 ComfyUI 地址与 API Key</div>
                        </div>

                        <div class="cf-group">
                            <div style="display:flex; gap:15px; align-items:center;">
                                <label class="cf-label" style="font-size:13px; color:#fff;">ComfyUI API 地址</label>
                                <input id="cf-url" class="cf-inp" value="${comfyURL}" placeholder="http://127.0.0.1:8188" onchange="localStorage.setItem('cf_v53_api_url', this.value)">
                                <button id="cf-conn-btn" class="cf-btn">🔌 测试连接</button>
                            </div>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:20px;">
                            <div style="width:100%;">
                                <h3 style="color:#4dabf7; font-size:15px;">⚙️ API JSON <span id="cf-status-api" class="cf-status-label">${currentApiName}</span></h3>
                                <div style="display:flex; gap:8px; margin-bottom:10px;">
                                    <input type="file" id="cf-file-api" accept=".json" style="display:none">
                                    <label for="cf-file-api" class="cf-btn" style="flex:1;">📂 导入</label>
                                    <button class="cf-btn red" onclick="clearApiData()">清空</button>
                                </div>
                                <textarea id="cf-json-api-raw" class="cf-inp" rows="3" placeholder="JSON 内容..." style="color:#aaa; font-family:monospace; min-height:80px;"></textarea>
                                <div style="margin-top:15px;">
                                    <div style="display:flex; gap:8px; margin-bottom:10px;"><input id="cf-preset-api-name" class="cf-inp" placeholder="预设名称..."><button class="cf-btn blue" onclick="savePreset('api')">💾 保存</button></div>
                                    <div id="cf-preset-list-api" class="cf-preset-list"></div>
                                </div>
                            </div>
                            <hr style="border:0; border-top:1px dashed #333; width:100%;">
                            <div style="width:100%;">
                                <h3 style="color:#ffec99; font-size:15px;">🗺️ Visual JSON <span id="cf-status-vis" class="cf-status-label">${currentVisName}</span></h3>
                                <div style="display:flex; gap:8px; margin-bottom:10px;">
                                    <input type="file" id="cf-file-vis" accept=".json" style="display:none">
                                    <label for="cf-file-vis" class="cf-btn" style="flex:1;">📂 导入</label>
                                    <button class="cf-btn red" onclick="clearVisData()">清空</button>
                                </div>
                                <textarea id="cf-json-vis-raw" class="cf-inp" rows="3" placeholder="JSON 内容..." style="color:#aaa; font-family:monospace; min-height:80px;"></textarea>
                                <div style="margin-top:15px;">
                                    <div style="display:flex; gap:8px; margin-bottom:10px;"><input id="cf-preset-vis-name" class="cf-inp" placeholder="预设名称..."><button class="cf-btn blue" onclick="savePreset('vis')">💾 保存</button></div>
                                    <div id="cf-preset-list-vis" class="cf-preset-list"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div id="view-prompts" class="cf-view cf-scroll-y">
                        <div class="cf-group" style="display:flex; gap:10px; flex-wrap:wrap;">
                            <button class="cf-btn blue" onclick="window.addPromptPanel('positive')">+ 正面面板</button>
                            <button class="cf-btn red" onclick="window.addPromptPanel('negative')">+ 负面面板</button>
                            <button class="cf-btn orange" onclick="window.addPromptPanel('custom')">+ 自定义面板</button>
                        </div>
                        <div id="cf-prompts-container"></div>
                    </div>

                    <div id="view-llm" class="cf-view cf-scroll-y">
                        <div class="cf-group">
                            <h3 style="color:#8e44ad; margin-bottom:10px;">🤖 连接设置</h3>
                            <div style="display:flex; gap:10px; margin-bottom:10px;">
                                <input id="cf-llm-url" class="cf-inp" value="${llmSettings.url}" placeholder="URL" onchange="updateLlmSetting('url', this.value)" style="flex:2;">
                                <input id="cf-llm-key" class="cf-inp" type="password" value="${llmSettings.key}" placeholder="Key" onchange="updateLlmSetting('key', this.value)" style="flex:1;">
                                <button class="cf-btn blue" onclick="window.saveLlmSettingsManual()">💾</button>
                            </div>
                            <div style="display:flex; gap:10px; align-items:center;">
                                <div id="cf-model-container" style="flex:1;"><input id="cf-llm-model" class="cf-inp" value="${llmSettings.model}" placeholder="Model" onchange="updateLlmSetting('model', this.value)"></div>
                                <button class="cf-btn orange" onclick="window.fetchLlmModels()">⬇️</button>
                                <button class="cf-btn purple" onclick="window.testLlmConnection()">🔌</button>
                                <span id="cf-llm-status" style="font-size:12px; color:#666;"></span>
                            </div>
                        </div>

                        <div class="cf-group">
                            <h3 style="color:#20c997; margin-bottom:10px;">🧠 系统预设 (System Presets)</h3>
                            <label class="cf-label">System Prompt 预览：</label>
                            <textarea id="cf-sys-preview" class="cf-inp" rows="3" readonly style="color:#aaa; font-style:italic; margin-bottom:15px;"></textarea>

                            <div style="display:flex; flex-direction:column; gap:20px;">
                                <div style="width:100%;">
                                    <div class="cf-preset-section-head"><span style="color:#e03131;">🔓 破限 (Jailbreak)</span></div>
                                    <div class="cf-preset-edit-area">
                                        <div style="display:flex; gap:5px; margin-bottom:5px;">
                                            <input id="inp-jailbreak-name" class="cf-inp" placeholder="预设名称 (如: Default)">
                                            <input type="file" id="file-jailbreak" style="display:none" onchange="window.importTextFile(this, 'inp-jailbreak-content')">
                                            <label for="file-jailbreak" class="cf-btn" style="padding:4px 8px;">📂 导入</label>
                                        </div>
                                        <textarea id="inp-jailbreak-content" class="cf-inp" rows="4" placeholder="破限内容文本..."></textarea>
                                        <button class="cf-btn blue" style="width:100%; margin-top:5px;" onclick="addPreset('jailbreak')">💾 保存 / 更新</button>
                                    </div>
                                    <div id="list-jailbreak" class="cf-preset-list"></div>
                                </div>

                                <div style="width:100%;">
                                    <div class="cf-preset-section-head"><span style="color:#1098ad;">📋 任务 (Task)</span></div>
                                    <div class="cf-preset-edit-area">
                                        <div style="display:flex; gap:5px; margin-bottom:5px;">
                                            <input id="inp-task-name" class="cf-inp" placeholder="预设名称 (如: SD Prompter)">
                                            <input type="file" id="file-task" style="display:none" onchange="window.importTextFile(this, 'inp-task-content')">
                                            <label for="file-task" class="cf-btn" style="padding:4px 8px;">📂 导入</label>
                                        </div>
                                        <textarea id="inp-task-content" class="cf-inp" rows="4" placeholder="任务指令文本..."></textarea>
                                        <button class="cf-btn blue" style="width:100%; margin-top:5px;" onclick="addPreset('task')">💾 保存 / 更新</button>
                                    </div>
                                    <div id="list-task" class="cf-preset-list"></div>
                                </div>

                                <div style="width:100%;">
                                    <div class="cf-preset-section-head"><span style="color:#d6336c;">👤 角色 (Character)</span></div>
                                    <div class="cf-preset-edit-area">
                                        <div style="display:flex; gap:5px; margin-bottom:5px;">
                                            <input id="inp-char-name" class="cf-inp" placeholder="角色名称">
                                            <input type="file" id="file-char" style="display:none" onchange="window.importTextFile(this, 'inp-char-content')">
                                            <label for="file-char" class="cf-btn" style="padding:4px 8px;">📂 导入</label>
                                        </div>
                                        <div style="margin-bottom:5px;">
                                            <select id="cf-char-history-sel" class="cf-sel" onchange="window.restoreCharVersion(this.value)">
                                                <option value="">🕒 历史版本 (按角色分组)</option>
                                            </select>
                                        </div>
                                        <textarea id="inp-char-content" class="cf-inp" rows="4" placeholder="角色设定文本..."></textarea>
                                        <button class="cf-btn blue" style="width:100%; margin-top:5px;" onclick="addPreset('char')">💾 保存 / 更新</button>
                                    </div>
                                    <div id="list-char" class="cf-preset-list"></div>
                                </div>
                            </div>
                        </div>

                        <div class="cf-group" style="border-color:#e67700;">
                            <h3 style="color:#ff922b; margin-bottom:10px;">🧪 提示词实验室 (Prompt Lab)</h3>
                            <div style="margin-bottom:10px;">
                                <label class="cf-label">用户输入 (双击底栏 🪄 可自动覆盖此处)</label>
                                <textarea id="cf-test-user-input" class="cf-inp" rows="3" placeholder="剧情内容...">${capturedContext}</textarea>
                            </div>
                            <button id="cf-btn-generate-test" class="cf-btn green" style="width:100%; margin-bottom:15px;" onclick="window.generatePromptTest()">
                                <span class="fa-solid fa-wand-magic-sparkles"></span> ✨ 分析并生成 (Analyze & Generate)
                            </button>
                            <div style="margin-bottom:10px; display:flex; flex-direction:column; gap:5px;">
                                <label class="cf-checkbox-label">
                                    <input type="checkbox" id="cf-auto-gen-check" ${autoGenEnabled ? "checked" : ""} onchange="window.toggleAutoGen(this.checked)">
                                    <span>☑️ 自动生图 / 自动覆盖资料</span>
                                </label>
                                <label class="cf-checkbox-label">
                                    <input type="checkbox" id="cf-random-seed-check" ${randomSeedEnabled ? "checked" : ""} onchange="window.toggleRandomSeed(this.checked)">
                                    <span>☑️ 重绘/生图强制随机种子 (Random Seed)</span>
                                </label>
                            </div>
                            <div id="cf-dynamic-output-container">
                                <label class="cf-label">AI 解析结果 (Parsed Output)</label>
                                <div id="cf-dynamic-output" style="min-height:100px;">
                                    <div style="text-align:center; color:#555; padding:20px;">暂无结果，请点击上方生成按钮</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(div);

        document.getElementById("cf-conn-btn").onclick = () => checkConnection(document.getElementById("cf-url").value);
        document.getElementById("cf-run-btn").onclick = runWorkflow;
        document.getElementById("cf-file-api").onchange = (e) => handleFileImport(e, 'api');
        document.getElementById("cf-file-vis").onchange = (e) => handleFileImport(e, 'vis');
        
        renderPresetList('jailbreak');
        renderPresetList('task');
        renderPresetList('char');

        window.renderCharacterHistorySelect();

        initCanvasControls();
        renderPresets('api');
        renderPresets('vis');
    }

    // ----------------------------------------
    // 4. 动态面板
    // ----------------------------------------
    window.renderPromptPanels = function() {
        const container = document.getElementById("cf-prompts-container");
        if(!container) return;
        container.innerHTML = "";

        promptPanels.forEach((panel) => {
            const typeClass = `cf-panel-type-${panel.type}`;
            const showLora = panel.type === 'positive' || panel.type === 'custom';
            const showEmbed = panel.type === 'negative' || panel.type === 'custom';
            const showFixes = panel.type === 'positive'; 
            
            const savedStates = panel.savedStates || [];
            const savedOptions = savedStates.map((s, idx) => `<option value="${idx}">${s.name}</option>`).join("");

            const targetHtml = `
                <div style="display:flex; gap:10px; margin-bottom:10px; align-items:center; background:#181818; padding:8px; border-radius:4px;">
                    <div style="flex:1;">
                        <label class="cf-label">1. 节点 (Node)</label>
                        <select id="cf-panel-node-${panel.id}" class="cf-sel" onchange="window.updatePanelWidget('${panel.id}')">
                            <option value="">(加载 API JSON)</option>
                        </select>
                    </div>
                    <div style="flex:1;">
                        <label class="cf-label">2. 参数 (Widget)</label>
                        <select id="cf-panel-widget-${panel.id}" class="cf-sel" onchange="window.savePanelConfig('${panel.id}', 'widgetId', this.value)">
                            <option value="">--</option>
                        </select>
                    </div>
                </div>
            `;

            let resourceHtml = "";
            if (showLora || showEmbed) {
                resourceHtml += `<div style="display:flex; gap:10px; margin-top:10px;">`;
                if (showLora) {
                    resourceHtml += `
                        <div style="flex:1;">
                            <label class="cf-label" style="color:#fcc419;">Lora 注入 (Suffix)</label>
                            <select id="cf-lora-${panel.id}" class="cf-sel" onchange="window.injectResource('${panel.id}', 'lora', this.value)">
                                <option value="">选择 Lora...</option>
                                ${resourceCache.loras.map(l => `<option value="${l}">${l}</option>`).join('')}
                            </select>
                        </div>`;
                }
                if (showEmbed) {
                    resourceHtml += `
                        <div style="flex:1;">
                            <label class="cf-label" style="color:#da77f2;">Embedding 注入</label>
                            <select id="cf-embed-${panel.id}" class="cf-sel" onchange="window.injectResource('${panel.id}', 'embed', this.value)">
                                <option value="">选择 Embedding...</option>
                                ${resourceCache.embeddings.map(e => `<option value="${e}">${e}</option>`).join('')}
                            </select>
                        </div>`;
                }
                resourceHtml += `</div>`;
            }

            const presetsHtml = `
                <div class="cf-panel-presets-area">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                        <span style="font-size:11px; font-weight:bold; color:#aaa;">📚 快捷存档 (Quick Save)</span>
                    </div>
                    <div style="display:flex; gap:5px;">
                        <input id="cf-panel-save-name-${panel.id}" class="cf-inp" placeholder="存档名" style="flex:1; font-size:11px; padding:4px;">
                        <button class="cf-btn blue" style="padding:4px 8px; font-size:11px;" onclick="window.savePanelState('${panel.id}')">💾 存</button>
                        <select class="cf-sel" style="flex:1; font-size:11px; padding:4px;" onchange="window.loadPanelState('${panel.id}', this.value)">
                            <option value="">-- 切换内容 --</option>
                            ${savedOptions}
                        </select>
                        <button class="cf-btn red" style="padding:4px 8px; font-size:11px;" onclick="window.deletePanelState('${panel.id}')">🗑️</button>
                    </div>
                </div>
            `;

            let promptBody = "";
            if (showFixes) {
                promptBody = `
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <div>
                            <label class="cf-label" style="color:#74c0fc;">1. 前缀 (Prefix)</label>
                            <textarea id="cf-pre-${panel.id}" class="cf-inp" rows="2" placeholder="Start..." oninput="window.savePanelConfig('${panel.id}', 'prefix', this.value)">${panel.prefix||''}</textarea>
                        </div>
                        <div>
                            <label class="cf-label" style="color:#fff;">2. 描述内容 (Text)</label>
                            <textarea id="cf-text-${panel.id}" class="cf-inp" rows="4" placeholder="Main Prompt..." oninput="window.savePanelConfig('${panel.id}', 'text', this.value)">${panel.text}</textarea>
                        </div>
                        <div>
                            <label class="cf-label" style="color:#74c0fc;">3. 后缀 (Suffix)</label>
                            <textarea id="cf-suf-${panel.id}" class="cf-inp" rows="2" placeholder="End..." oninput="window.savePanelConfig('${panel.id}', 'suffix', this.value)">${panel.suffix||''}</textarea>
                        </div>
                    </div>
                `;
            } else {
                promptBody = `
                    <label class="cf-label">提示词内容 (Text)</label>
                    <textarea id="cf-text-${panel.id}" class="cf-inp" rows="4" placeholder="Prompt..." oninput="window.savePanelConfig('${panel.id}', 'text', this.value)">${panel.text}</textarea>
                `;
            }

            const html = `
                <div class="cf-panel-box ${typeClass}">
                    <div class="cf-panel-head">
                        <input class="cf-inp" style="width:200px; background:transparent; border:none; font-weight:bold;" value="${panel.name}" onchange="window.savePanelConfig('${panel.id}', 'name', this.value)">
                        <button class="cf-btn red" style="padding:2px 8px;" onclick="window.removePanel('${panel.id}')">×</button>
                    </div>
                    <div class="cf-panel-body">
                        ${targetHtml}
                        ${presetsHtml}
                        ${promptBody}
                        ${resourceHtml}
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', html);
            populatePanelNodeSelect(panel.id);
        });
    }

    // ----------------------------------------
    // 5. 核心注入逻辑
    // ----------------------------------------
    function clearInjectedButtons() {
        document.querySelectorAll('.cf-inject-wrapper').forEach(wrapper => {
            if (!wrapper.querySelector('.cf-result-img')) {
                wrapper.remove();
            }
        });
    }

    function injectNodeAfterText(rootElement, searchText, nodeToInject) {
        let textMap = [];
        let fullText = "";
        // Re-traverse to get fresh map
        function traverse(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                for (let i = 0; i < node.nodeValue.length; i++) {
                    textMap.push({ node: node, offset: i, char: node.nodeValue[i] });
                }
                fullText += node.nodeValue;
            } else { node.childNodes.forEach(traverse); }
        }
        traverse(rootElement);
        const idx = fullText.lastIndexOf(searchText);
        if (idx === -1) return false;
        const endIdx = idx + searchText.length;
        if (endIdx >= textMap.length) { rootElement.appendChild(nodeToInject); } else {
            const mapEntry = textMap[endIdx - 1]; const targetNode = mapEntry.node; const splitPoint = mapEntry.offset + 1;
            if (splitPoint < targetNode.nodeValue.length) {
                const remainderNode = targetNode.splitText(splitPoint); targetNode.parentNode.insertBefore(nodeToInject, remainderNode);
            } else {
                const nextSibling = targetNode.nextSibling;
                if (nextSibling) { targetNode.parentNode.insertBefore(nodeToInject, nextSibling); } else { targetNode.parentNode.appendChild(nodeToInject); }
            }
        }
        return true;
    }

    function injectButtonIntoChat(locatorText, promptText) {
        if (!locatorText || !promptText) return null;
        const messages = document.querySelectorAll('.mes_text');
        if (messages.length === 0) return null;
        const cleanLocator = locatorText.trim();
        const safePrompt = promptText.replace(/"/g, '&quot;').replace(/'/g, "\\'");
        const btnId = `btn-${Date.now()}-${Math.floor(Math.random()*1000)}`;
        const wrapper = document.createElement("span");
        wrapper.className = "cf-inject-wrapper";
        wrapper.id = `wrapper-${btnId}`;
        wrapper.innerHTML = `
            <button id="${btnId}" class="cf-inject-btn" onclick="window.handleInjectedClick(event, '${btnId}', '${safePrompt}')">
                <span class="fa-solid fa-paintbrush"></span> 🎨 立即生成
            </button>
        `;
        let injected = false;
        for (let i = messages.length - 1; i >= 0; i--) {
            const messageEl = messages[i];
            if (messageEl.innerText.includes(cleanLocator)) {
                if (injectNodeAfterText(messageEl, cleanLocator, wrapper)) { 
                    injected = true;
                    break; 
                }
            }
        }
        
        if(injected) {
            tempLocators[btnId] = cleanLocator;
        }
        return injected ? btnId : null;
    }

    window.handleInjectedClick = function(e, btnId, promptText) {
        if(e) e.stopPropagation();
        const btn = document.getElementById(btnId);
        if (!btn) return;
        if (btn.classList.contains("loading")) {
            btn.classList.remove("loading");
            btn.innerHTML = `<span class="fa-solid fa-paintbrush"></span> 🎨 立即生成`;
            delete btn.dataset.promptId;
            showToast("⏹️ 已中止等待");
            return;
        }
        const posPanel = promptPanels.find(p => p.type === 'positive');
        if(posPanel) {
            posPanel.text = promptText;
            savePanels();
            const el = document.getElementById(`cf-text-${posPanel.id}`);
            if(el) el.value = promptText;
        }
        btn.innerHTML = `<span class="fa-solid fa-spinner fa-spin"></span> 点击中止`;
        btn.classList.add("loading");
        runWorkflow(btnId);
    }

    window.toggleAutoGen = function(checked) {
        autoGenEnabled = checked;
        localStorage.setItem("cf_v53_auto_gen", checked);
        showToast(checked ? "⚡ 自动生图/自动保存 已开启" : "⏸️ 自动功能已关闭");
    }

    window.toggleRandomSeed = function(checked) {
        randomSeedEnabled = checked;
        localStorage.setItem("cf_v53_random_seed", checked);
        showToast(checked ? "🎲 强制随机种子已开启" : "🎲 强制随机种子已关闭");
    }

    window.generatePromptTest = async function() {
        const userInput = document.getElementById("cf-test-user-input").value;
        const btn = document.getElementById("cf-btn-generate-test");
        const outContainer = document.getElementById("cf-dynamic-output");
        if(!userInput) return alert("请输入内容");
        
        clearInjectedButtons();

        const sysPrompt = getFullSystemPrompt();
        btn.innerHTML = `<span class="fa-solid fa-spinner fa-spin"></span> 分析中...`; btn.disabled = true; 
        outContainer.innerHTML = `<div style="text-align:center; padding:20px; color:#aaa;">Thinking...</div>`;
        try {
            const url = getCleanApiUrl('chat');
            const res = await fetch(url, {
                method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${llmSettings.key}` },
                body: JSON.stringify({ model: llmSettings.model, messages: [{ role: "system", content: sysPrompt }, { role: "user", content: userInput }] })
            });
            if(res.ok) {
                const data = await res.json();
                parseAndRenderOutput(data.choices?.[0]?.message?.content || "");
            } else throw new Error(await res.text());
        } catch(e) { outContainer.innerHTML = `<div style="color:red; padding:10px;">Error: ${e.message}</div>`; } 
        finally { btn.innerHTML = `<span class="fa-solid fa-wand-magic-sparkles"></span> ✨ 分析并生成`; btn.disabled = false; }
    }

    function parseAndRenderOutput(text) {
        const container = document.getElementById("cf-dynamic-output"); container.innerHTML = "";
        const regex = /(<(?:角色|定位)>)([\s\S]*?)(<\/(?:角色|定位)>)/g;
        const dataRegex = /<资料>([\s\S]*?)<\/资料>/g;

        let currentRole = null;
        let sceneIndex = 0;
        let foundAny = false;

        let matches = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
            matches.push(match);
        }
        
        matches.forEach(m => {
            const tag = m[1];
            const content = m[2].trim();

            if (tag === '<角色>') {
                currentRole = content;
                const posPanel = promptPanels.find(p => p.type === 'positive');
                if(posPanel) {
                    posPanel.text = currentRole;
                    savePanels();
                    const el = document.getElementById(`cf-text-${posPanel.id}`);
                    if(el) el.value = currentRole;
                }
            } else if (tag === '<定位>') {
                if (currentRole) {
                    sceneIndex++;
                    foundAny = true;
                    const promptText = currentRole; 
                    const locationText = content;
                    
                    setTimeout(() => {
                        const newBtnId = injectButtonIntoChat(locationText, promptText);
                        if (autoGenEnabled && newBtnId) {
                            setTimeout(() => {
                                window.handleInjectedClick(null, newBtnId, promptText.replace(/'/g, "\\'"));
                            }, 500); 
                        }
                    }, sceneIndex * 100);

                    container.insertAdjacentHTML('beforeend', `
                        <div class="cf-dynamic-card cf-card-role">
                            <div class="cf-card-header"><span>🎬 画面生成 (Scene ${sceneIndex})</span></div>
                            <div class="cf-card-body">
                                <div class="cf-card-meta"><span class="fa-solid fa-location-dot" style="color:#4dabf7;"></span><span style="font-style:italic;">"${locationText.substring(0, 50)}..."</span></div>
                                <textarea id="role-card-${sceneIndex}-prompt" class="cf-inp" rows="3" style="margin-bottom:10px;">${promptText}</textarea>
                                <button class="cf-btn blue" style="width:100%;" onclick="window.handleRoleAction(null, '${promptText.replace(/'/g, "\\'")}')">🚀 填入正面面板</button>
                            </div>
                        </div>
                    `);
                    currentRole = null; 
                }
            }
        });
        
        let datas = [...text.matchAll(dataRegex)];
        datas.forEach((match, index) => {
            foundAny = true;
            container.insertAdjacentHTML('beforeend', `<div class="cf-dynamic-card cf-card-data"><div class="cf-card-header"><span>📚 角色资料 (Data)</span></div><div class="cf-card-body"><textarea id="data-card-${index}-content" class="cf-inp" rows="3">${match[1].trim()}</textarea><button class="cf-btn orange" style="width:100%; margin-top:10px;" onclick="window.handleDataAction('data-card-${index}')">💾 自动识别保存 (Auto Save)</button></div></div>`);
            if (autoGenEnabled) {
                setTimeout(() => window.handleDataAction(`data-card-${index}`), 1000);
            }
        });

        if (!foundAny) {
            container.innerHTML = `<div class="cf-dynamic-card"><div class="cf-card-header" style="background:#555;">⚠️ 未识别到成对标签 (Raw Output)</div><div class="cf-card-body"><textarea class="cf-inp" rows="4">${text}</textarea></div></div>`; 
        }
    }

    window.handleRoleAction = function(cardId, directContent=null) {
        let promptVal = "";
        if (directContent !== null) promptVal = directContent;
        else if (cardId) promptVal = document.getElementById(`${cardId}-prompt`).value;
        if(!promptVal) return showToast("❌ Prompt 为空");
        const posPanel = promptPanels.find(p => p.type === 'positive');
        if(posPanel) {
            posPanel.text = promptVal; savePanels();
            const el = document.getElementById(`cf-text-${posPanel.id}`); if(el) el.value = promptVal;
            showToast(`✅ 已填入 [${posPanel.name}]`);
        } else { alert("❌ 未找到 [正面提示词] 面板"); }
    }

    window.handleDataAction = function(cardId) {
        const content = document.getElementById(`${cardId}-content`).value; if(!content) return;
        let extractedName = "";
        const nameMatch = content.match(/(?:Name|Name:|角色名|角色名：)\s*([^\n,]+)/i);
        if (nameMatch && nameMatch[1]) extractedName = nameMatch[1].trim();
        else extractedName = prompt("未识别到角色名，请输入:", "New Character");
        if(!extractedName) return;
        
        const existingIdx = presets.char.findIndex(p => p.name === extractedName);
        if(existingIdx >= 0) { 
            document.getElementById("inp-char-name").value = extractedName;
            document.getElementById("inp-char-content").value = content;
            window.addPreset('char', true); 
        } else { 
            presets.char.push({ id: Date.now(), name: extractedName, content, active: true, history: [] }); 
            showToast(`💾 已新建角色: ${extractedName}`); 
            savePresetsToStorage('char'); renderPresetList('char'); updateSystemPromptPreview();
            window.renderCharacterHistorySelect(); 
        }
    }

    window.savePanelState = function(panelId) {
        const nameInput = document.getElementById(`cf-panel-save-name-${panelId}`);
        const name = nameInput.value.trim();
        if (!name) return alert("请输入存档名称");
        const panel = promptPanels.find(p => p.id === panelId); if(!panel) return;
        const newState = { name: name, text: panel.text, prefix: panel.prefix || "", suffix: panel.suffix || "" };
        const existingIdx = panel.savedStates.findIndex(s => s.name === name);
        if(existingIdx >= 0) { if(!confirm(`存档 [${name}] 已存在，是否覆盖？`)) return; panel.savedStates[existingIdx] = newState; } else { panel.savedStates.push(newState); }
        savePanels(); renderPromptPanels(); showToast("💾 面板内容已保存");
    }
    window.loadPanelState = function(panelId, idxStr) {
        if(idxStr === "") return; const idx = parseInt(idxStr); const panel = promptPanels.find(p => p.id === panelId);
        if(!panel || !panel.savedStates[idx]) return; const state = panel.savedStates[idx];
        panel.text = state.text; panel.prefix = state.prefix; panel.suffix = state.suffix;
        savePanels(); renderPromptPanels(); showToast(`🔄 已加载: ${state.name}`);
    }
    window.deletePanelState = function(panelId) {
        const name = prompt("请输入要删除的存档名称:"); if(!name) return;
        const panel = promptPanels.find(p => p.id === panelId); const initialLen = panel.savedStates.length;
        panel.savedStates = panel.savedStates.filter(s => s.name !== name);
        if(panel.savedStates.length < initialLen) { savePanels(); renderPromptPanels(); showToast("🗑️ 已删除"); } else { alert("未找到该名称的存档"); }
    }
    function populatePanelNodeSelect(panelId) {
        if (!apiWorkflow) return; const select = document.getElementById(`cf-panel-node-${panelId}`); if(!select) return;
        const panel = promptPanels.find(p => p.id === panelId); select.innerHTML = `<option value="">-- 选择节点 --</option>`;
        for (const nodeId in apiWorkflow) { const node = apiWorkflow[nodeId]; let hasString = false; if (node.inputs) { for (const key in node.inputs) { if (typeof node.inputs[key] === 'string') hasString = true; } } if (hasString) { const selected = (panel.nodeId === nodeId) ? "selected" : ""; select.innerHTML += `<option value="${nodeId}" ${selected}>[#${nodeId}] ${node.class_type}</option>`; } }
        if (panel.nodeId) updatePanelWidget(panelId, false);
    }
    window.updatePanelWidget = function(panelId, save=true) {
        const nodeSelect = document.getElementById(`cf-panel-node-${panelId}`); const widgetSelect = document.getElementById(`cf-panel-widget-${panelId}`); const nodeId = nodeSelect.value; const panel = promptPanels.find(p => p.id === panelId);
        if (save) { panel.nodeId = nodeId; panel.widgetId = ""; savePanels(); } widgetSelect.innerHTML = `<option value="">-- 选择输入框 --</option>`;
        if (nodeId && apiWorkflow[nodeId]) { const node = apiWorkflow[nodeId]; for (const key in node.inputs) { if (typeof node.inputs[key] === 'string') { const selected = (panel.widgetId === key) ? "selected" : ""; widgetSelect.innerHTML += `<option value="${key}" ${selected}>${key}</option>`; } } }
    }
    window.addPromptPanel = function(type) { const id = "panel_" + Date.now(); const name = type === 'positive' ? "新正面面板" : (type === 'negative' ? "新负面面板" : "自定义面板"); promptPanels.push({ id, type, name, text: '', prefix: '', suffix: '', nodeId: '', widgetId: '', savedStates: [] }); savePanels(); renderPromptPanels(); }
    window.removePanel = function(id) { if(!confirm("删除此面板？")) return; promptPanels = promptPanels.filter(p => p.id !== id); savePanels(); renderPromptPanels(); }
    window.savePanelConfig = function(id, key, val) { const p = promptPanels.find(x => x.id === id); if(p) { p[key] = val; savePanels(); } }
    function savePanels() { localStorage.setItem("cf_v53_prompt_panels", JSON.stringify(promptPanels)); }
    window.injectResource = function(panelId, type, val) { if (!val) return; const p = promptPanels.find(x => x.id === panelId); if (!p) return; let injection = (type === 'lora') ? `<lora:${val}:1.0>` : `embedding:${val}`; if (type === 'lora' && p.type === 'positive') { const el = document.getElementById(`cf-suf-${panelId}`); if(el) { const c = el.value; const n = c ? (c + ", " + injection) : injection; el.value = n; p.suffix = n; } } else { const el = document.getElementById(`cf-text-${panelId}`); if(el) { const c = el.value; const n = c + (c.trim() === "" ? "" : ", ") + injection; el.value = n; p.text = n; } } const sel = document.getElementById(type === 'lora' ? `cf-lora-${panelId}` : `cf-embed-${panelId}`); if(sel) sel.value = ""; savePanels(); }
    window.importTextFile = function(inputEl, targetId) { const file = inputEl.files[0]; if(!file) return; const reader = new FileReader(); reader.onload = (e) => { document.getElementById(targetId).value = e.target.result; showToast("📂 文件已导入文本框"); }; reader.readAsText(file); inputEl.value = ""; }

    // V53.4: 修复 addPreset
    window.addPreset = function(type, force=false) { 
        const nameEl = document.getElementById(`inp-${type}-name`); 
        const contentEl = document.getElementById(`inp-${type}-content`); 
        const name = nameEl ? nameEl.value.trim() : ""; 
        const content = contentEl ? contentEl.value.trim() : ""; 
        if(!name || !content) return alert("请填写名称和内容"); 
        
        const existingIdx = presets[type].findIndex(p => p.name === name); 
        if(existingIdx >= 0) { 
            if (type === 'char') {
                const charItem = presets[type][existingIdx];
                if (!charItem.history) charItem.history = [];
                charItem.history.unshift({
                    timestamp: Date.now(),
                    content: charItem.content
                });
                if (charItem.history.length > 20) charItem.history.pop();
            }

            if(!force && !confirm(`预设 [${name}] 已存在，是否更新内容？`)) return; 
            
            presets[type][existingIdx].content = content; 
            if(type !== 'char') presets[type].forEach(p => p.active = false); 
            presets[type][existingIdx].active = true; 
            showToast("🔄 预设已更新"); 
        } else { 
            if(type !== 'char') presets[type].forEach(p => p.active = false); 
            presets[type].push({ id: Date.now(), name, content, active: true, history: [] }); 
            showToast("💾 预设已新建"); 
        } 
        savePresetsToStorage(type); 
        renderPresetList(type); 
        updateSystemPromptPreview(); 
        if (type === 'char') {
            window.loadPresetToEditor('char', presets['char'].find(p=>p.name===name).id);
            window.renderCharacterHistorySelect(); 
        }
    }

    // V53.4: 仅加载，不切换
    window.loadPresetToEditor = function(type, id) { 
        const item = presets[type].find(p => p.id === id); 
        if(item) { 
            document.getElementById(`inp-${type}-name`).value = item.name; 
            document.getElementById(`inp-${type}-content`).value = item.content; 
        } 
    }

    window.renderCharacterHistorySelect = function() {
        const histSel = document.getElementById("cf-char-history-sel");
        if (!histSel) return;
        
        histSel.innerHTML = `<option value="">🕒 历史版本 (请选择)</option>`;
        
        presets.char.forEach(charItem => {
            if (charItem.history && charItem.history.length > 0) {
                const group = document.createElement('optgroup');
                group.label = charItem.name;
                
                charItem.history.forEach((h, idx) => {
                    const date = new Date(h.timestamp);
                    const timeStr = `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2,'0')}`;
                    const opt = document.createElement('option');
                    opt.value = `${charItem.id}|${idx}`;
                    opt.innerText = `v${idx+1} (${timeStr})`;
                    group.appendChild(opt);
                });
                histSel.appendChild(group);
            }
        });
    }

    window.restoreCharVersion = function(val) {
        if (!val) return;
        const [charIdStr, histIdxStr] = val.split("|");
        const charId = parseInt(charIdStr);
        const histIdx = parseInt(histIdxStr);
        
        const charItem = presets.char.find(p => p.id === charId);
        if (charItem && charItem.history && charItem.history[histIdx]) {
            if(confirm(`确认将编辑器内容回退到 [${charItem.name}] 的 v${histIdx+1} 版本？`)) {
                document.getElementById("inp-char-name").value = charItem.name;
                document.getElementById("inp-char-content").value = charItem.history[histIdx].content;
                showToast("⏪ 内容已回填，请点击保存生效");
            }
        }
    }

    // V53.4: 角色列表渲染 (UI 分离: 主体加载 / 锁钮开关)
    function renderPresetList(type) { 
        const container = document.getElementById(`list-${type}`); 
        if(!container) return; 
        container.innerHTML = ""; 
        
        presets[type].forEach(item => { 
            const activeClass = item.active ? "active" : ""; 
            const lockIcon = item.active ? "fa-lock" : "fa-lock-open";
            const lockColor = item.active ? "green" : "gray";
            
            let html = `<div class="cf-preset-item ${activeClass}" onclick="window.loadPresetToEditor('${type}', ${item.id})">`;
            
            html += `<div style="flex:1; overflow:hidden;">
                        <div style="font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.name}</div>
                        <div style="font-size:10px; color:#666; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.content.substring(0,40).replace(/\n/g, ' ')}...</div>
                    </div>`;
            
            if (type === 'char') {
                html += `<button class="cf-btn ${lockColor}" style="padding:2px 6px; margin-left:5px; font-size:10px;" onclick="event.stopPropagation(); window.togglePreset('${type}', ${item.id})"><span class="fa-solid ${lockIcon}"></span></button>`;
            }
            
            html += `<button class="cf-btn red" style="padding:2px 6px; margin-left:5px; font-size:10px;" onclick="event.stopPropagation(); window.deletePresetItem('${type}', ${item.id})">×</button></div>`;
            
            container.innerHTML += html;
        }); 
    }

    function getFullSystemPrompt() { const jb = presets.jailbreak.find(p => p.active)?.content || ""; const task = presets.task.find(p => p.active)?.content || ""; const chars = presets.char.filter(p => p.active).map(p => p.content).join("\n\n"); return [jb, task, chars].filter(s => s).join("\n\n---\n\n"); }
    function updateSystemPromptPreview() { const el = document.getElementById("cf-sys-preview"); if(el) el.value = getFullSystemPrompt(); }

    // V53.4: Toggle 只负责切换状态
    window.togglePreset = function(type, id) { 
        if(type === 'char') { 
            const p = presets[type].find(i => i.id === id); 
            if(p) p.active = !p.active; 
        } else { 
            presets[type].forEach(p => p.active = (p.id === id)); 
        } 
        savePresetsToStorage(type); 
        renderPresetList(type); 
        updateSystemPromptPreview(); 
    }

    window.deletePresetItem = function(type, id) { if(!confirm("确认删除?")) return; presets[type] = presets[type].filter(p => p.id !== id); savePresetsToStorage(type); renderPresetList(type); updateSystemPromptPreview(); window.renderCharacterHistorySelect(); }
    function savePresetsToStorage(type) { try { localStorage.setItem(`cf_v53_${type}`, JSON.stringify(presets[type])); } catch(e) { console.error(e); } }
    async function fetchResources() { if (!comfyURL) return; try { const res = await fetch(`${comfyURL}/object_info/LoraLoader`); if (res.ok) { const data = await res.json(); if (data && data.LoraLoader && data.LoraLoader.input && data.LoraLoader.input.required && data.LoraLoader.input.required.lora_name) { resourceCache.loras = data.LoraLoader.input.required.lora_name[0]; } } } catch(e) {} try { const res = await fetch(`${comfyURL}/embeddings`); if (res.ok) { const data = await res.json(); if (Array.isArray(data)) resourceCache.embeddings = data; } } catch(e) {} renderPromptPanels(); }

    // ... API & Visual functions ...
    async function checkConnection(url) {
        const b = document.getElementById("cf-conn-btn"); b.innerText = "⏳";
        try { 
            let u = url.replace(/\/$/,""); if(!u.startsWith("http")) u="http://"+u; 
            const r = await fetch(`${u}/object_info`); 
            if(r.ok) { nodeDefinitions = await r.json(); comfyURL = u; localStorage.setItem("cf_v53_api_url", u); b.innerText = "✅"; b.className = "cf-btn green"; if(visualWorkflow) drawCanvas(); fetchResources(); initWebSocket(); } else throw new Error(); 
        } catch(e) { b.innerText = "❌"; b.className = "cf-btn red"; }
    }

    async function runWorkflow(triggerBtnId = null) {
        if(!apiWorkflow) return alert("请先导入 API JSON");
        
        if (randomSeedEnabled) {
            let changed = false;
            for (const nodeId in apiWorkflow) {
                const inputs = apiWorkflow[nodeId].inputs;
                if (inputs) {
                    for (const key in inputs) {
                        if (key === 'seed' || key === 'noise_seed') {
                            inputs[key] = Math.floor(Math.random() * 100000000000000);
                            changed = true;
                        }
                    }
                }
            }
            if (changed) {
                localStorage.setItem("cf_v53_api_json", JSON.stringify(apiWorkflow));
                if (visualWorkflow) drawCanvas(); 
            }
        }

        promptPanels.forEach(p => {
            if (p.nodeId && p.widgetId) {
                let content = p.text;
                if (p.prefix) content = p.prefix + ", " + content;
                if (p.suffix) content = content + ", " + p.suffix;
                if (apiWorkflow[p.nodeId] && apiWorkflow[p.nodeId].inputs) { apiWorkflow[p.nodeId].inputs[p.widgetId] = content; }
            }
        });

        const b = document.getElementById("cf-run-btn"); 
        if(!triggerBtnId) { b.innerText = "⏳..."; b.disabled = true; }

        try { 
            const res = await fetch(`${comfyURL}/prompt`, { 
                method: "POST", 
                headers: {"Content-Type":"application/json"}, 
                body: JSON.stringify({prompt: apiWorkflow, client_id: clientId}) 
            }); 
            
            if(res.ok) { 
                const data = await res.json();
                const promptId = data.prompt_id;
                showToast("🚀 已发送指令"); 
                
                if(!triggerBtnId) document.getElementById("cf-mask").classList.remove("show");
                if (triggerBtnId) {
                    const btn = document.getElementById(triggerBtnId);
                    if (btn) {
                        btn.dataset.promptId = promptId;
                    }
                }
            } 
        } catch(e) { 
            alert("网络错误"); 
            if(triggerBtnId) {
                const btn = document.getElementById(triggerBtnId);
                if(btn) { 
                    btn.innerHTML = "❌ 失败"; 
                    btn.classList.remove("loading");
                }
            }
        } finally { 
            if(!triggerBtnId) { b.innerText = "🚀 立即生成"; b.disabled = false; }
        }
    }

    // ... Common & Canvas ...
    window.updateLlmSetting = function(key, val) { llmSettings[key] = val; localStorage.setItem(`cf_v53_llm_${key}`, val); }
    window.saveLlmSettingsManual = function() { localStorage.setItem("cf_v53_llm_url", llmSettings.url); localStorage.setItem("cf_v53_llm_key", llmSettings.key); localStorage.setItem("cf_v53_llm_model", llmSettings.model); localStorage.setItem("cf_v53_llm_sys", llmSettings.systemPrompt); showToast("💾 设置已保存"); }
    function getCleanApiUrl(pathType) { let url = llmSettings.url.trim().replace(/\/$/, ""); if (url.endsWith("/chat/completions")) url = url.replace("/chat/completions", ""); else if (url.endsWith("/models")) url = url.replace("/models", ""); if (pathType === 'chat') return url + "/chat/completions"; if (pathType === 'models') return url + "/models"; return url; }
    window.fetchLlmModels = async function() { const s = document.getElementById("cf-llm-status"); s.innerText = "Connecting..."; try { const res = await fetch(getCleanApiUrl('models'), { method: "GET", headers: { "Authorization": `Bearer ${llmSettings.key}` } }); const data = await res.json(); const models = data.data || data.models || []; if(models.length > 0) { const c = document.getElementById("cf-model-container"); let h = `<select id="cf-llm-model" class="cf-sel" onchange="window.updateLlmSetting('model', this.value)">`; models.forEach(m => { const id = m.id || m; h += `<option value="${id}" ${id === llmSettings.model ? "selected" : ""}>${id}</option>`; }); h += `</select>`; c.innerHTML = h; s.innerText = `✅ ${models.length}`; s.style.color="green"; } } catch(e) { s.innerText = "❌ Error"; s.style.color="red"; } }
    window.testLlmConnection = async function() { try { await fetch(getCleanApiUrl('chat'), { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${llmSettings.key}` }, body: JSON.stringify({ model: llmSettings.model, messages: [{role:"user",content:"hi"}], max_tokens:1 }) }); showToast("✅ 连接成功"); } catch(e) { alert(e); } }
    function drawCanvas() { if(!visualWorkflow) return; const nc = document.getElementById("cf-canvas-nodes"); const ls = document.getElementById("cf-canvas-links"); const gc = document.getElementById("cf-canvas-groups"); nc.innerHTML = ""; ls.innerHTML = ""; gc.innerHTML = ""; if(visualWorkflow.groups) visualWorkflow.groups.forEach(g => { const d = document.createElement("div"); d.className = "cf-canvas-group"; d.style.left=g.bounding[0]+"px"; d.style.top=g.bounding[1]+"px"; d.style.width=g.bounding[2]+"px"; d.style.height=g.bounding[3]+"px"; d.innerText=g.title||""; gc.appendChild(d); }); visualWorkflow.nodes.forEach(n => { if (n.mode === 2 || n.mode === 4) return; const e = document.createElement("div"); e.className = "cf-canvas-node"; e.id = `node-${n.id}`; e.dataset.id = n.id; e.style.left = n.pos[0] + "px"; e.style.top = n.pos[1] + "px"; e.style.width = n.size[0] + "px"; let h = `<div class="cf-canvas-node-head" style="background:${n.color||'#333'}" data-node-id="${n.id}"><span>${n.title || n.type}</span></div><div class="cf-canvas-node-body">`; if(n.inputs) n.inputs.forEach((i, x) => { h += `<div class="cf-node-row cf-row-in"><div class="cf-socket-handle" data-node="${n.id}" data-type="in" data-slot="${x}" style="background:${getSocketColor(i.type)}"></div><span class="cf-label">${i.name}</span></div>`; }); if(n.outputs) n.outputs.forEach((o, x) => { h += `<div class="cf-node-row cf-row-out"><span class="cf-label">${o.name}</span><div class="cf-socket-handle" data-node="${n.id}" data-type="out" data-slot="${x}" style="background:${getSocketColor(o.type)}"></div></div>`; }); h += `<div id="node-widgets-${n.id}" style="padding:4px 6px;"></div></div>`; e.innerHTML = h; nc.appendChild(e); if(apiWorkflow && apiWorkflow[n.id]) renderNodeWidgets(n.id, n.type, apiWorkflow[n.id].inputs, document.getElementById(`node-widgets-${n.id}`)); }); setTimeout(() => { updateSocketCache(); drawLinks(); }, 50); ls.style.width = "50000px"; ls.style.height = "50000px"; }
    function getSocketColor(t) { const m = { "IMAGE": "#fcc419", "LATENT": "#ff8787", "MODEL": "#da77f2", "CONDITIONING": "#ffc9c9", "CLIP": "#ffd43b", "VAE": "#ff6b6b", "MASK": "#a5d8ff", "INT": "#ffffff", "STRING": "#eebefa" }; return m[t] || "#888"; }
    function updateSocketCache() { socketCache = {}; const s = canvasState.scale; document.querySelectorAll(".cf-socket-handle").forEach(e => { const nid = e.dataset.node; const isIn = e.dataset.type === "in"; const slot = parseInt(e.dataset.slot); const el = document.getElementById(`node-${nid}`); if(!el) return; const sr = e.getBoundingClientRect(); const nr = el.getBoundingClientRect(); const rx = (sr.left - nr.left + sr.width/2) / s; const ry = (sr.top - nr.top + sr.height/2) / s; if(!socketCache[nid]) socketCache[nid] = { in: {}, out: {} }; if(isIn) socketCache[nid].in[slot] = { x: rx, y: ry }; else socketCache[nid].out[slot] = { x: rx, y: ry }; }); }
    function drawLinks() { if(!visualWorkflow || !visualWorkflow.links) return; const ls = document.getElementById("cf-canvas-links"); let ph = ""; const pm = {}; visualWorkflow.nodes.forEach(n => pm[n.id] = {x: n.pos[0], y: n.pos[1]}); visualWorkflow.links.forEach(l => { const oid = l[1], os = l[2], tid = l[3], ts = l[4]; const on = pm[oid], tn = pm[tid]; const off = socketCache[oid]?.out[os], tff = socketCache[tid]?.in[ts]; if(!on || !tn || !off || !tff) return; const sx = on.x + off.x; const sy = on.y + off.y; const ex = tn.x + tff.x; const ey = tn.y + tff.y; const d = Math.abs(ex - sx) * 0.5; ph += `<path d="M ${sx} ${sy} C ${sx + d} ${sy}, ${ex - d} ${ey}, ${ex} ${ey}" class="cf-link-path" stroke="${getSocketColor(l[5])}"></path>`; }); ls.innerHTML = ph; }
    function renderNodeWidgets(nid, type, inps, cont) { if(!nodeDefinitions[type]) return; const def = nodeDefinitions[type]; const idefs = { ...(def.input?.required || {}), ...(def.input?.optional || {}) }; for (const k in inps) { let v = inps[k]; if (Array.isArray(v)) continue; let idef = idefs[k]; if(!idef) continue; let t = idef[0]; let h = ""; if (k === 'image' && typeof v === 'string') { const src = v.startsWith("http") ? v : `${comfyURL}/view?filename=${v}&type=input`; h = `<div class="cf-preview-box"><img src="${src}" id="pv-${nid}-${k}" class="cf-preview-img"></div><div class="cf-widget-row"><span class="cf-widget-label">Image</span><label class="cf-mini-btn">⬆<input type="file" accept="image/*" style="display:none" onchange="uploadHandler(this, '${nid}', '${k}')"></label></div>`; } else if (Array.isArray(t)) { h = `<div class="cf-widget-row"><span class="cf-widget-label">${k}</span><select class="cf-sel cf-sync" data-id="${nid}" data-key="${k}">`; t.forEach(o => h += `<option value="${o}" ${o===v?"selected":""}>${o}</option>`); h += `</select></div>`; } else if (k.includes("seed") || k === "seed") { h = `<div class="cf-widget-row"><span class="cf-widget-label">Seed</span><input type="number" class="cf-inp cf-sync" data-id="${nid}" data-key="${k}" value="${v}" style="width:70px;"><button class="cf-mini-btn" onclick="randomSeed('${nid}', '${k}')">🎲</button></div>`; } else if (t === "INT" || t === "FLOAT" || typeof v === 'number') { h = `<div class="cf-widget-row"><span class="cf-widget-label">${k}</span><input type="number" step="any" class="cf-inp cf-sync" data-id="${nid}" data-key="${k}" value="${v}"></div>`; } else if (t === "STRING" || typeof v === 'string') { if (v.length > 20 || k.includes("text")) { h = `<div style="padding:2px 6px;"><span class="cf-widget-label">${k}</span><textarea class="cf-inp cf-sync" data-id="${nid}" data-key="${k}" rows="2">${v}</textarea></div>`; } else { h = `<div class="cf-widget-row"><span class="cf-widget-label">${k}</span><input type="text" class="cf-inp cf-sync" data-id="${nid}" data-key="${k}" value="${v}"></div>`; } } if(h) cont.insertAdjacentHTML('beforeend', h); } cont.querySelectorAll(".cf-sync").forEach(e => { e.addEventListener('input', (ev) => { let v = ev.target.value; if(ev.target.tagName === 'INPUT' && ev.target.type === 'number') v = Number(v); if(apiWorkflow && apiWorkflow[nid]) { apiWorkflow[nid].inputs[ev.target.dataset.key] = v; localStorage.setItem("cf_v53_api_json", JSON.stringify(apiWorkflow)); } }); }); }
    
    // V53.11: Init Canvas Controls with Mobile Touch Support
    function initCanvasControls() { 
        const vp = document.getElementById("cf-canvas-viewport"); 
        const w = document.getElementById("cf-canvas-world"); 
        
        const up = () => { 
            w.style.transform = `translate(${canvasState.x}px, ${canvasState.y}px) scale(${canvasState.scale})`; 
        }; 

        // Helper to get coordinates (Mouse or Touch)
        const getXY = (e) => {
            if(e.touches && e.touches.length > 0) {
                return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
            return { x: e.clientX, y: e.clientY };
        };

        const startDrag = (e) => {
            // Check if touch target is a button or input, if so, allow default action
            if(['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName)) return;

            const h = e.target.closest(".cf-canvas-node-head");
            const pos = getXY(e);

            if(h) { 
                canvasState.isDraggingNode = true; 
                canvasState.draggedNodeId = parseInt(h.dataset.nodeId); 
                canvasState.lastX = pos.x; 
                canvasState.lastY = pos.y; 
                h.parentElement.style.zIndex = ++canvasState.zIndexCounter; 
                e.preventDefault(); // Stop text selection
            } else { 
                canvasState.isPanning = true; 
                canvasState.lastX = pos.x; 
                canvasState.lastY = pos.y; 
                vp.classList.add("panning"); 
                // e.preventDefault(); // Optional: might block scrolling if needed
            } 
        };

        const moveDrag = (e) => {
            const pos = getXY(e);
            
            if(canvasState.isDraggingNode && canvasState.draggedNodeId !== null) { 
                const dx = (pos.x - canvasState.lastX) / canvasState.scale; 
                const dy = (pos.y - canvasState.lastY) / canvasState.scale; 
                const n = visualWorkflow.nodes.find(n => n.id === canvasState.draggedNodeId); 
                if(n) { 
                    n.pos[0] += dx; n.pos[1] += dy; 
                    const el = document.getElementById(`node-${n.id}`); 
                    if(el) { el.style.left = n.pos[0] + "px"; el.style.top = n.pos[1] + "px"; } 
                    updateSocketCache(); drawLinks(); 
                } 
                canvasState.lastX = pos.x; 
                canvasState.lastY = pos.y; 
                e.preventDefault(); // Prevent page scroll while dragging node
            } else if(canvasState.isPanning) { 
                canvasState.x += pos.x - canvasState.lastX; 
                canvasState.y += pos.y - canvasState.lastY; 
                canvasState.lastX = pos.x; 
                canvasState.lastY = pos.y; 
                up(); 
                e.preventDefault(); // Prevent page scroll while panning
            } 
        };

        const endDrag = () => { 
            canvasState.isPanning = false; 
            canvasState.isDraggingNode = false; 
            vp.classList.remove("panning"); 
            if(visualWorkflow) localStorage.setItem("cf_v53_visual_json", JSON.stringify(visualWorkflow)); 
        };

        // Mouse Events
        vp.addEventListener("mousedown", startDrag);
        window.addEventListener("mousemove", moveDrag);
        window.addEventListener("mouseup", endDrag);

        // Touch Events (Passive: false allows preventDefault)
        vp.addEventListener("touchstart", startDrag, { passive: false });
        window.addEventListener("touchmove", moveDrag, { passive: false });
        window.addEventListener("touchend", endDrag);

        // Zoom (Mouse Wheel)
        vp.addEventListener("wheel", (e) => { 
            e.preventDefault(); 
            const d = e.deltaY > 0 ? 0.9 : 1.1; 
            canvasState.scale = Math.min(Math.max(0.1, canvasState.scale * d), 5); 
            up(); 
        }); 
    }

    window.switchTab = function(n, t) { document.querySelectorAll(".cf-tab").forEach(e=>e.classList.remove("active")); t.classList.add("active"); document.querySelectorAll(".cf-view").forEach(e=>e.classList.remove("active")); document.getElementById("view-"+n).classList.add("active"); if(n==='visual') setTimeout(() => { updateSocketCache(); drawLinks(); }, 100); }
    window.uploadHandler = async function(el, nid, k) { const f = el.files[0]; if(!f) return; const fd = new FormData(); fd.append("image", f); fd.append("overwrite", "true"); fd.append("type", "input"); try { const res = await fetch(`${comfyURL}/upload/image`, { method: "POST", body: fd }); if(res.ok) { const d = await res.json(); document.getElementById(`pv-${nid}-${k}`).src = URL.createObjectURL(f); if(apiWorkflow) { apiWorkflow[nid].inputs[k] = d.name; localStorage.setItem("cf_v53_api_json", JSON.stringify(apiWorkflow)); } } } catch(e) {} }
    window.randomSeed = (id, k) => { const el = document.querySelector(`.cf-sync[data-id="${id}"][data-key="${k}"]`); if(el) { el.value = Math.floor(Math.random()*1e14); el.dispatchEvent(new Event('input')); } }
    window.savePreset = function(t) { const n = document.getElementById(`cf-preset-${t}-name`).value.trim() || "未命名"; let d = (t === 'api') ? JSON.stringify(apiWorkflow) : JSON.stringify(visualWorkflow); const l = (t === 'api') ? apiPresets : visPresets; l.push({ id: Date.now(), name: n, data: d }); localStorage.setItem(`cf_v53_${t}_presets`, JSON.stringify(l)); renderPresets(t); }
    window.loadPreset = function(t, i) { const l = (t === 'api') ? apiPresets : visPresets; const item = l[i]; if(t === 'api') { currentApiName = item.name; parseApiJson(item.data); } else { currentVisName = item.name; parseVisualJson(item.data); } document.getElementById(`cf-status-${t}`).innerText = item.name; }
    window.deletePreset = function(t, i) { if(!confirm("删除?")) return; const l = (t === 'api') ? apiPresets : visPresets; l.splice(i, 1); localStorage.setItem(`cf_v53_${t}_presets`, JSON.stringify(l)); renderPresets(t); }
    function renderPresets(t) { const c = document.getElementById(`cf-preset-list-${t}`); c.innerHTML = ""; const l = (t === 'api') ? apiPresets : visPresets; l.forEach((item, idx) => { c.innerHTML += `<div class="cf-preset-item"><span>${item.name}</span><div><button class="cf-btn" style="padding:2px 8px;" onclick="window.loadPreset('${t}',${idx})">Load</button> <button class="cf-btn red" style="padding:2px 8px;" onclick="window.deletePreset('${t}',${idx})">×</button></div></div>`; }); }
    function parseApiJson(s, sv=true) { try { apiWorkflow = JSON.parse(s); document.getElementById("cf-json-api-raw").value = s; if(sv) localStorage.setItem("cf_v53_api_json", s); renderPromptPanels(); } catch(e){} }
    function parseVisualJson(s, sv=true) { try { visualWorkflow = JSON.parse(s); document.getElementById("cf-json-vis-raw").value = s; if(sv) localStorage.setItem("cf_v53_visual_json", s); drawCanvas(); } catch(e){} }
    function clearApiData() { apiWorkflow=null; localStorage.removeItem("cf_v53_api_json"); currentApiName=""; document.getElementById("cf-status-api").innerText=""; document.getElementById("cf-json-api-raw").value=""; renderPromptPanels(); }
    function clearVisData() { visualWorkflow=null; localStorage.removeItem("cf_v53_visual_json"); currentVisName=""; document.getElementById("cf-status-vis").innerText=""; document.getElementById("cf-canvas-nodes").innerHTML=""; document.getElementById("cf-canvas-links").innerHTML=""; document.getElementById("cf-json-vis-raw").value=""; }
    window.handleFileImport = function(e, t) { const f = e.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = (ev) => { if(t === 'api') { currentApiName = f.name; localStorage.setItem("cf_v53_api_name", currentApiName); parseApiJson(ev.target.result); document.getElementById("cf-status-api").innerText = currentApiName; } else { currentVisName = f.name; localStorage.setItem("cf_v53_vis_name", currentVisName); parseVisualJson(ev.target.result); document.getElementById("cf-status-vis").innerText = currentVisName; } }; r.readAsText(f); }

    injectStyles();
    initSystem();

})();