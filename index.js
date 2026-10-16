import { getContext } from "../../../extensions.js";
import { chat, event_types, eventSource } from '../../../../script.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';

const extensionName = "st-info-block-merged";

let lastPromptData = null;
let currentEntryList = [];
let generationType;

let panel;
let wiContainer;

const strategy = { constant: '🔵', normal: '🟢', vectorized: '🔗' };
const getStrategy = (entry) => {
    if (entry.constant === true) return 'constant';
    if (entry.vectorized === true) return 'vectorized';
    return 'normal';
};

function countContext(showToast = false) {
    const context = getContext();
    if (!chat || !Array.isArray(chat)) return;

    const totalMessages = chat.length;
    const hiddenMessages = chat.filter(m => m.is_system === true);
    const visibleMessages = chat.filter(m => m.is_system !== true);

    let visibleTokens = 0;
    let hiddenTokens = 0;

    if (context && typeof context.getTokenCount === 'function') {
        for (const m of visibleMessages) visibleTokens += context.getTokenCount(m.mes || "");
        for (const m of hiddenMessages) hiddenTokens += context.getTokenCount(m.mes || "");
    }

    let totalPromptTokens = 0;
    let systemTokens = 0;

    if (lastPromptData && lastPromptData.prompt) {
        for (const item of lastPromptData.prompt) {
            const text = typeof item.content === "string" ? item.content : JSON.stringify(item.content);
            if (context && typeof context.getTokenCount === 'function') {
                const t = context.getTokenCount(text);
                totalPromptTokens += t;
                if (item.role === "system") systemTokens += t;
            }
        }
    }

    $(panel).find("#cm_total_messages").text(totalMessages);
    $(panel).find("#cm_visible_messages").text(visibleMessages.length);
    $(panel).find("#cm_hidden_messages").text(hiddenMessages.length);
    $(panel).find("#cm_chat_tokens_visible").text(visibleTokens.toLocaleString());
    $(panel).find("#cm_chat_tokens_hidden").text(hiddenTokens.toLocaleString());

    if (lastPromptData) {
        $(panel).find("#cm_prompt_total").text(totalPromptTokens.toLocaleString());
        $(panel).find("#cm_prompt_system").text(systemTokens.toLocaleString());
        $(panel).find("#cm_prompt_chat").text((totalPromptTokens - systemTokens).toLocaleString());
        $(panel).find("#cm_no_prompt_warning").hide();
        $(panel).find("#cm_prompt_stats").show();
    } else {
        $(panel).find("#cm_no_prompt_warning").show();
        $(panel).find("#cm_prompt_stats").hide();
    }
    
    if (showToast) toastr.success("Context counted!", "Info Block");
}

// Функция для скрытия/раскрытия сообщений через слэш-команды Таверны
async function toggleMessages(range, forceState = null) {
    const firstId = parseInt(range.split('-')[0]);
    const targetState = forceState !== null ? forceState : !chat[firstId]?.is_system;
    const commandName = targetState ? 'hide' : 'unhide';
    
    if (SlashCommandParser.commands[commandName]) {
        await SlashCommandParser.commands[commandName].callback({}, range);
        countContext(false);
    }
}

const init = () => {
    panel = document.createElement('div');
    panel.classList.add('stwii--panel');
    panel.style.display = 'none';
    panel.innerHTML = `
        <div class="stwii--stats-container">
            <div class="cm-stats">
                <div style="margin-bottom: 6px; text-align: center;">
                    <input id="cm_hide_btn" class="menu_button" type="button" value="👁️ Hide / Unhide Messages" style="width: 100%; cursor: pointer;">
                </div>
                <div style="margin-bottom: 10px; text-align: center;">
                    <input id="cm_count_btn" class="menu_button" type="submit" value="🔍 Count Context" style="width: 100%; cursor: pointer;">
                </div>
                <div class="cm-section-title">💬 Messages</div>
                <div class="cm-row"><span>Total:</span> <b id="cm_total_messages">—</b></div>
                <div class="cm-row"><span>Visible:</span> <b id="cm_visible_messages">—</b></div>
                <div class="cm-row cm-muted"><span>Hidden (/hide):</span> <b id="cm_hidden_messages">—</b></div>
                <div class="cm-section-title" style="margin-top: 8px;">💬 Chat tokens</div>
                <div class="cm-row"><span>Visible messages:</span> <b id="cm_chat_tokens_visible">—</b></div>
                <div class="cm-row cm-muted"><span>Hidden messages:</span> <b id="cm_chat_tokens_hidden">—</b></div>
                <div class="cm-section-title" style="margin-top: 8px;">📤 Last sent prompt</div>
                <div id="cm_no_prompt_warning" class="cm-warning">⚠️ Make a generation first</div>
                <div id="cm_prompt_stats" style="display:none;">
                    <div class="cm-row cm-total"><span>Total (prompt_tokens):</span> <b id="cm_prompt_total">—</b></div>
                </div>
            </div>
        </div>
        <div class="stwii--wi-container">Waiting for World Info...</div>
    `;
    document.body.append(panel);
    wiContainer = panel.querySelector('.stwii--wi-container');

    // Кнопка скрытия/раскрытия сообщений (над Count Context)
    $(document).on('click', '#cm_hide_btn', async function(e) {
        e.preventDefault();
        e.stopPropagation();

        if (!chat || !chat.length) {
            toastr.warning("Чат пуст.");
            return;
        }

        const lastMesId = Math.max(0, chat.length - 1);
        const rangeStr = window.prompt('Введите диапазон (например, 0-35) или ID одного сообщения:', `0-${lastMesId}`);
        if (!rangeStr) return;
        
        const isValid = /^\s*\d+\s*(-\s*\d+\s*)?$/.test(rangeStr);
        
        if (isValid) {
            const cleanRange = rangeStr.replace(/\s+/g, '');
            const firstId = parseInt(cleanRange.split('-')[0]);
            
            if (firstId >= chat.length) {
                toastr.error(`Сообщение с ID ${firstId} не существует (всего сообщений: ${chat.length}).`);
                return;
            }

            const currentState = chat[firstId]?.is_system;
            const confirmMsg = currentState ? `Раскрыть сообщения: ${cleanRange}?` : `Скрыть сообщения: ${cleanRange}?`;
            
            if (window.confirm(confirmMsg)) {
                await toggleMessages(cleanRange, !currentState);
                toastr.success(currentState ? `Сообщения (${cleanRange}) раскрыты!` : `Сообщения (${cleanRange}) скрыты!`);
            }
        } else {
            toastr.error("Неверный формат. Используйте 'X-Y' или 'X'.");
        }
    });

    // Кнопка ручного пересчета контекста
    $(document).on('click', '#cm_count_btn', function(e) {
        e.preventDefault(); 
        e.stopPropagation();
        const btn = $(this); 
        const originalVal = btn.val(); 
        btn.val('Calculating...');
        try { 
            countContext(true); 
            setTimeout(() => btn.val(originalVal), 500); 
        } catch(err) {}
    });

    // Отслеживание генерации и промпта
    eventSource.on(event_types.GENERATION_STARTED, (genType) => generationType = genType);
    const context = getContext();
    eventSource.on(context.event_types.GENERATE_AFTER_DATA ?? "generate_after_data", (data) => lastPromptData = data);

    // Отслеживание World Info
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, async (entryList) => {
        wiContainer.innerHTML = 'Updating...';
        for (const entry of entryList) {
            entry.type = 'wi';
            if (SlashCommandParser.commands['wi-get-timed-effect']) {
                entry.sticky = parseInt(await SlashCommandParser.commands['wi-get-timed-effect'].callback({ effect: 'sticky', format: 'number', file: `${entry.world}`, _scope: null, _abortController: null }, entry.uid));
            }
        }
        currentEntryList = [...entryList];
        updatePanel(entryList, true);
    });

    const updatePanel = (entryList, newChat = false) => {
        wiContainer.innerHTML = ''; 
        const context = getContext();
        const grouped = Object.groupBy(entryList, (it) => it.world);
        for (const [world, entries] of Object.entries(grouped)) {
            const w = document.createElement('div');
            w.classList.add('stwii--world');
            w.textContent = world;
            wiContainer.append(w);
            for (const entry of entries) {
                const e = document.createElement('div');
                e.classList.add('stwii--entry');
                const strat = document.createElement('div');
                strat.textContent = strategy[getStrategy(entry)];
                e.append(strat);
                const title = document.createElement('div');
                title.textContent = entry.comment?.length ? entry.comment : entry.key.join(', ');
                e.title = `[${entry.world}] ${title.textContent}\n---\n${entry.content}`;
                e.append(title);
                if (context && typeof context.getTokenCount === 'function') {
                    const tokensBadge = document.createElement('div');
                    tokensBadge.textContent = `${context.getTokenCount(entry.content || "")}t`;
                    tokensBadge.classList.add('stwii--token-badge');
                    e.append(tokensBadge);
                }
                wiContainer.append(e);
            }
        }
    };

    // Интеграция в «Волшебную палочку»
    const addMagicWandButton = () => {
        const wandMenu = $('#extensionsMenu');
        if (wandMenu.length && $('#stwii_wand_container').length === 0) {
            const wandContainer = $(`<div id="stwii_wand_container" class="extension_container interactable" tabindex="0">
                <div class="list-group-item flex-container flexGap5 interactable" tabindex="0" role="listitem">
                    <i class="fa-solid fa-layer-group"></i> <span>ST Info Blocks</span>
                </div>
            </div>`);

            wandContainer.on('click', function(e) {
                e.stopPropagation();
                $('#extensionsMenu').hide(); 
                
                if (panel.style.display === 'flex') {
                    panel.style.display = 'none';
                    return;
                }

                countContext(false);
                
                panel.style.visibility = 'hidden';
                panel.style.display = 'flex';
                
                const pWidth = panel.offsetWidth || 320;
                const pHeight = panel.offsetHeight || 400;
                
                panel.style.top = `${Math.max(10, (window.innerHeight - pHeight) / 2)}px`;
                panel.style.left = `${Math.max(10, (window.innerWidth - pWidth) / 2)}px`;
                panel.style.maxHeight = `${window.innerHeight - 20}px`; 
                
                panel.style.visibility = 'visible';
            });

            wandMenu.append(wandContainer);
        }
    };

    addMagicWandButton();
    setTimeout(addMagicWandButton, 2000);

    // Закрытие окна при клике вне панели
    $(document).on('click', function(e) {
        const isPanel = $(e.target).closest('.stwii--panel').length;
        const isWand = $(e.target).closest('#stwii_wand_container').length;
        
        if (!isPanel && !isWand) {
            if (panel.style.display === 'flex') panel.style.display = 'none';
        }
    });

    console.log(`[${extensionName}] ✅ Loaded successfully`);
};

jQuery(async () => { init(); });
