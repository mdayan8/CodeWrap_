/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Content } from "@google/genai";

// --- TYPES ---
interface Agent {
    name: string;
    description: string;
}

interface Suggestion {
    name: string;
    description: string;
}

// --- CONSTANTS & CONFIG ---
const API_KEY = process.env.API_KEY;
const DEFAULT_AGENTS: Agent[] = [
    { name: 'Planner', description: 'Analyzes the user\'s request and creates a detailed, step-by-step plan. Its only job is to plan and delegate; it does not write code or files.' },
    { name: 'ProjectManager', description: 'Handles file structure, creates/updates multiple files, and manages the overall project state.' },
    { name: 'CodeGenerator', description: 'Focuses on writing a specific piece of code or a single file based on detailed instructions.' },
    { name: 'WebAppResearcher', description: 'Uses Google Search to find up-to-date information, modern code examples, or answers to complex questions. Always cites its sources.' },
    { name: 'CodeTester', description: 'Analyzes code for logical errors, finds bugs, suggests improvements, and can write test cases. Cannot visually test the application.' },
    { name: 'Debugger', description: 'Analyzes code for syntax errors, finds bugs, and suggests fixes or improvements.' },
    { name: 'Explainer', description: 'Explains complex code, concepts, or provides documentation in an easy-to-understand way.' },
];
const CLIENT_COMMANDS: Suggestion[] = [
    { name: '/run', description: 'Renders your project in a new tab.' },
    { name: '/files', description: 'Lists all files in the project.' },
    { name: '/save', description: 'Saves your project to browser storage.' },
    { name: '/download', description: 'Downloads project as a single HTML file.' },
    { name: '/publish', description: 'Shows instructions on how to deploy your app.' },
    { name: '/clear', description: 'Clears the terminal and all project files.' },
    { name: '/settings', description: 'Customize the AI agents.' },
    { name: '/agents', description: 'Learn about the AI agent system.' },
    { name: '/help', description: 'Shows all available commands.' },
    { name: '/exit', description: 'Returns to the main landing page.' },
];


// --- STATE ---
const projectFiles = new Map<string, string>();
let agents: Agent[] = [];
let conversationHistory: Content[] = [];
let ai: GoogleGenAI;
let activeSuggestionIndex = -1;
let currentSuggestions: Suggestion[] = [];
let isAwaitingConfirmation = false;


// --- DOM ELEMENTS ---
const loaderEl = document.getElementById("loader") as HTMLDivElement;
const landingPageEl = document.getElementById("landing-page") as HTMLElement;
const launchBtn = document.getElementById("launch-btn") as HTMLButtonElement;
const launchBtnCta = document.getElementById("launch-btn-cta") as HTMLButtonElement;
const appContainerEl = document.getElementById("app-container") as HTMLDivElement;
const historyEl = document.getElementById("history") as HTMLDivElement;
const formEl = document.getElementById("prompt-form") as HTMLFormElement;
const inputEl = document.getElementById("prompt-input") as HTMLInputElement;
const suggestionsPopoverEl = document.getElementById("suggestions-popover") as HTMLDivElement;
// Agent Settings Modal
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const agentSettingsModalEl = document.getElementById("agent-settings-modal") as HTMLDivElement;
const closeSettingsBtn = document.getElementById("close-settings-btn") as HTMLButtonElement;
const saveSettingsBtn = document.getElementById("save-settings-btn") as HTMLButtonElement;
const agentListEl = document.getElementById("agent-list") as HTMLDivElement;
const addAgentForm = document.getElementById("add-agent-form") as HTMLFormElement;
const newAgentNameInput = document.getElementById("new-agent-name") as HTMLInputElement;
const newAgentDescriptionTextarea = document.getElementById("new-agent-description") as HTMLTextAreaElement;
// File Viewer Modal
const fileViewerModalEl = document.getElementById("file-viewer-modal") as HTMLDivElement;
const closeViewerBtn = document.getElementById("close-viewer-btn") as HTMLButtonElement;
const fileViewerFilenameEl = document.getElementById("file-viewer-filename") as HTMLElement;
const fileViewerContentEl = document.getElementById("file-viewer-content") as HTMLElement;


// --- AGENT & AI SETUP ---

function loadAgentsFromStorage(): void {
    const storedAgents = localStorage.getItem('codewrap_agents');
    agents = storedAgents ? JSON.parse(storedAgents) : [...DEFAULT_AGENTS];
}

function saveAgentsToStorage(): void {
    localStorage.setItem('codewrap_agents', JSON.stringify(agents));
}

function generateSystemInstruction(): string {
    const agentList = agents.map(a => `- **[${a.name}]**: ${a.description}`).join('\n');
    return `You are the AI engine for "CodeWrap," a web-based IDE that looks and feels like a modern terminal AI assistant.

**Your Available Agent Personas:**
${agentList}

**Core Interaction Flow:**

1.  **Analyze & Plan:** Analyze the user's request. For any non-trivial request, adopt the [Planner] persona to create a step-by-step plan. Present the plan to the user.
2.  **Confirmation:** After presenting the plan, you MUST ask for confirmation by ending your response with the special tag: \`[awaiting_confirmation]\`. Do not execute until the user says "yes".
3.  **Execute:** Once confirmed, execute the plan.

**Response Formatting (IMPORTANT):**

*   You MUST always respond in Markdown.
*   Use bullet points (* list item) for lists or to describe your thoughts and actions.
*   Announce file operations clearly, e.g., \`* Updating \`index.html\` to add a title.\`.
*   Use bold (\`**text**\`) for emphasis and backticks (\`code\`) for inline code/filenames.

**File Operations (CRITICAL):**

*   To **create or update** a file, you MUST wrap its **full content** in special tags: \`[start of file: FILENAME]\` and \`[end of file: FILENAME]\`.
*   Inside these tags, provide the file content within a Markdown code block (e.g., \`\`\`html ... \`\`\`).
*   For **file updates**, you MUST use a diff-like format inside the code block.
    *   Prefix new lines with \`+ \`.
    *   Prefix removed lines with \`- \`.
    *   Prefix unchanged context lines with a single space \`  \` or no prefix.
*   For **new files**, just provide the raw code without \`+\` or \`-\` prefixes.

**Example Update:**
*Okay, I'll add a button to the HTML.*
[start of file: index.html]
\`\`\`html
  <body>
-   <h1>Hello</h1>
+   <h1>Hello World</h1>
+   <button>Click Me</button>
  </body>
\`\`\`
[end of file: index.html]

**Constraints:**
*   You can only generate client-side web applications (HTML, CSS, JavaScript).
*   If asked for backend functionality, explain that you can write the code files, but they must be run locally by the user. Provide simple instructions.
*   Do not respond to user commands like \`/run\` or \`/files\`. The client handles these.`;
}


function initializeAI(): void {
    ai = new GoogleGenAI({ apiKey: API_KEY });
    conversationHistory = [];
    console.log("AI Initialized.");
}

// --- STATE PERSISTENCE ---
function saveProjectToStorage(): void {
    const filesArray = Array.from(projectFiles.entries());
    localStorage.setItem('codewrap_project_files', JSON.stringify(filesArray));
    console.log('Project saved to localStorage.');
}

function loadProjectFromStorage(): void {
    const storedFiles = localStorage.getItem('codewrap_project_files');
    if (storedFiles) {
        try {
            const filesArray: [string, string][] = JSON.parse(storedFiles);
            if (filesArray.length > 0) {
                projectFiles.clear();
                filesArray.forEach(([name, content]) => projectFiles.set(name, content));
                addHistoryItem('<div class="system-confirm-line">✔ Loaded project from a previous session.</div>', 'log-system');
                console.log('Project loaded from localStorage.');
            }
        } catch (e) {
            console.error("Failed to load project files from storage", e);
            localStorage.removeItem('codewrap_project_files');
        }
    }
}


// --- UI FUNCTIONS ---

function addHistoryItem(content: string, ...classNames: string[]): HTMLElement {
    const item = document.createElement("div");
    item.className = classNames.join(' ');
    item.innerHTML = content;
    historyEl.appendChild(item);
    historyEl.scrollTop = historyEl.scrollHeight;
    return item;
}

function renderPreview(): void {
    const html = projectFiles.get('index.html') || '<body></body>';
    const css = projectFiles.get('style.css') || projectFiles.get('index.css') || '';
    const js = projectFiles.get('script.js') || projectFiles.get('index.js') || '';

    const srcDoc = `<html><head><style>${css}</style></head>${html}<script>${js}</script></html>`;
    
    const blob = new Blob([srcDoc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    
    window.open(url, '_blank');
    
    // Clean up the URL object after the new tab has had a chance to load
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    addHistoryItem('<div class="system-confirm-line">✔ Project is running in a new browser tab.</div>', 'log-system');
}

function downloadProjectAsBundle(): void {
    let htmlContent = projectFiles.get('index.html') || '<!DOCTYPE html><html><head><title>CodeWrap Project</title></head><body><p>Project started without an index.html file.</p></body></html>';
    let cssContent = '';
    let jsContent = '';

    for (const [fileName, content] of projectFiles.entries()) {
        if (fileName.endsWith('.css')) {
            cssContent += `\n/* --- ${fileName} --- */\n${content}`;
        } else if (fileName.endsWith('.js')) {
            jsContent += `\n// --- ${fileName} --- \n${content}\n`;
        }
    }

    // Inject CSS into <head>
    if (cssContent) {
        if (htmlContent.includes('</head>')) {
            htmlContent = htmlContent.replace('</head>', `<style>${cssContent}</style>\n</head>`);
        } else {
            htmlContent += `<style>${cssContent}</style>`;
        }
    }
    
    // Inject JS before </body>
    if (jsContent) {
        if (htmlContent.includes('</body>')) {
            htmlContent = htmlContent.replace('</body>', `<script>${jsContent}</script>\n</body>`);
        } else {
            htmlContent += `<script>${jsContent}</script>`;
        }
    }

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'index.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showFileContent(fileName: string) {
    const content = projectFiles.get(fileName);
    if (typeof content === 'string') {
        fileViewerFilenameEl.textContent = fileName;
        fileViewerContentEl.textContent = content; // Use textContent for security
        fileViewerModalEl.classList.remove('hidden');
    }
}

function hideFileViewer() {
    fileViewerModalEl.classList.add('hidden');
}

// --- AGENT SETTINGS MODAL UI ---
function populateAgentSettingsUI() {
    agentListEl.innerHTML = '';
    agents.forEach((agent, index) => {
        const item = document.createElement('div');
        item.className = 'agent-item';
        item.innerHTML = `
      <div class="agent-item-header">
        <strong>${agent.name}</strong>
        <button data-index="${index}">Delete</button>
      </div>
      <p class="agent-item-description">${agent.description}</p>
    `;
        agentListEl.appendChild(item);
    });
    // Add delete functionality
    agentListEl.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index || '-1');
            if (index > -1) {
                agents.splice(index, 1);
                populateAgentSettingsUI();
            }
        });
    });
}

function handleAddAgent(e: SubmitEvent) {
    e.preventDefault();
    const name = newAgentNameInput.value.trim().replace(/\s/g, ''); // No spaces in agent names
    const description = newAgentDescriptionTextarea.value.trim();
    if (name && description && !agents.some(a => a.name.toLowerCase() === name.toLowerCase())) {
        agents.push({ name, description });
        populateAgentSettingsUI();
        addAgentForm.reset();
    } else {
        alert("Agent name must be unique and non-empty.");
    }
}

// --- AUTOCOMPLETE/SUGGESTIONS ---

function updateSuggestions(suggestions: Suggestion[]) {
    currentSuggestions = suggestions;
    if (suggestions.length === 0) {
        hideSuggestions();
        return;
    }
    suggestionsPopoverEl.innerHTML = suggestions.map((s, i) => `
        <div class="suggestion-item" data-index="${i}">
            <span class="suggestion-name">${s.name}</span>
            <span class="suggestion-desc">${s.description}</span>
        </div>
    `).join('');
    suggestionsPopoverEl.classList.remove('hidden');
    activeSuggestionIndex = -1; // Reset selection
}

function hideSuggestions() {
    suggestionsPopoverEl.classList.add('hidden');
    currentSuggestions = [];
}

function setActiveSuggestion() {
    suggestionsPopoverEl.querySelectorAll('.suggestion-item').forEach((el, i) => {
        el.classList.toggle('active', i === activeSuggestionIndex);
    });
}

function selectSuggestion(index: number) {
    if (index >= 0 && index < currentSuggestions.length) {
        inputEl.value = currentSuggestions[index].name + ' ';
        hideSuggestions();
        inputEl.focus();
    }
}

function handleAutocomplete() {
    const value = inputEl.value;
    if (value.startsWith('/')) {
        const search = value.substring(1).toLowerCase();
        const filtered = CLIENT_COMMANDS.filter(c => c.name.toLowerCase().startsWith('/' + search));
        updateSuggestions(filtered);
    } else if (value.startsWith('@')) {
        const search = value.substring(1).toLowerCase();
        const agentSuggestions = agents.map(a => ({ name: `@${a.name}`, description: a.description }));
        const filtered = agentSuggestions.filter(a => a.name.toLowerCase().startsWith('@' + search));
        updateSuggestions(filtered);
    } else {
        hideSuggestions();
    }
}

function handleSuggestionKeydown(e: KeyboardEvent) {
    if (currentSuggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex + 1) % currentSuggestions.length;
        setActiveSuggestion();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
        setActiveSuggestion();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        selectSuggestion(activeSuggestionIndex);
    } else if (e.key === 'Escape') {
        hideSuggestions();
    }
}

// --- CLIENT COMMANDS ---

function handleClientCommands(prompt: string): boolean {
    if (!prompt.startsWith('/')) return false;
    const [command] = prompt.split(' ');
    const logItem = addHistoryItem('', 'log-system');

    switch (command) {
        case '/clear':
            historyEl.innerHTML = '';
            conversationHistory = [];
            projectFiles.clear();
            localStorage.removeItem('codewrap_project_files');
            showWelcomeMessage();
            return true;
        case '/files':
            if (projectFiles.size === 0) {
                 logItem.innerHTML = '<div>No files in the project.</div>'
            } else {
                 const fileLinks = Array.from(projectFiles.keys())
                    .map(name => `<li><a class="file-link" data-filename="${name}">${name}</a></li>`)
                    .join('');
                 logItem.innerHTML = `<ul class="file-link-list">${fileLinks}</ul>`;
            }
            return true;
        case '/run':
            historyEl.removeChild(logItem);
            renderPreview();
            return true;
        case '/save':
            saveProjectToStorage();
            logItem.innerHTML = '<div class="system-confirm-line">✔ Project files saved to browser storage.</div>';
            return true;
        case '/download':
            if (projectFiles.size === 0) {
                logItem.innerHTML = '<div>No files to download. Create some files first!</div>';
            } else {
                downloadProjectAsBundle();
                logItem.innerHTML = '<div class="system-confirm-line">✔ Project download started as `index.html`.</div>';
            }
            return true;
        case '/publish':
        case '/deploy':
            const deployText = `
<div class="help-content">
<h3>How to Deploy Your Project</h3>
<p>This app runs in your browser, so it can't publish code automatically. Here's how to do it manually:</p>
<ol style="list-style:decimal; padding-left: 20px; margin-top: 1rem; display: flex; flex-direction: column; gap: 1rem;">
<li><strong>Download:</strong> Use the <code>/download</code> command to get your project as a single <code>index.html</code> file.</li>
<li><strong>Create a Repo:</strong> Go to <a href="https://github.new" target="_blank" rel="noopener noreferrer">github.new</a> to create a new repository.</li>
<li><strong>Upload File:</strong> In the new repo, click "Add file" > "Upload files" and select your <code>index.html</code> file.</li>
<li><strong>Deploy:</strong> Sign up on a service like <a href="https://netlify.com" target="_blank" rel="noopener noreferrer">Netlify</a> or <a href="https://vercel.com" target="_blank" rel="noopener noreferrer">Vercel</a>, connect your GitHub account, select the new repository, and deploy!</li>
</ol></div>`;
            logItem.classList.add('help-panel');
            logItem.innerHTML = deployText;
            return true;
        case '/exit':
            appContainerEl.classList.add('hidden');
            landingPageEl.classList.remove('hidden');
            return true;
        case '/settings':
             populateAgentSettingsUI();
             agentSettingsModalEl.classList.remove('hidden');
             historyEl.removeChild(logItem);
             return true;
        case '/help':
        case '/commands':
            const helpText = `
<div class="help-content">
<h3>CodeWrap Commands</h3>

<h4>Core Actions</h4>
<ul>
<li><strong>/run</strong><span>-</span>Renders your project in a new tab.</li>
<li><strong>/save</strong><span>-</span>Saves your project to browser storage.</li>
<li><strong>/download</strong><span>-</span>Downloads project as a single HTML file.</li>
<li><strong>/publish</strong><span>-</span>Shows instructions on how to deploy.</li>
<li><strong>/clear</strong><span>-</span>Clears terminal and all project files.</li>
<li><strong>/exit</strong><span>-</span>Returns to the main landing page.</li>
</ul>

<h4>File Management</h4>
<ul>
<li><strong>/files</strong><span>-</span>Lists all files to view their code.</li>
</ul>

<h4>AI Interaction</h4>
<ul>
<li><strong>@AgentName</strong><span>-</span>Directly invoke a specific AI agent.</li>
<li><strong>/agents</strong><span>-</span>Learn about the AI agent system.</li>
<li><strong>/settings</strong><span>-</span>Customize the AI agents.</li>
</ul>
</div>`;
            logItem.classList.add('help-panel');
            logItem.innerHTML = helpText;
            return true;
        case '/agents':
            const agentInfo = agents.map(a => `<li><strong>[${a.name}]</strong><span>-</span>${a.description}</li>`).join('');
            const agentsHelpText = `
<div class="help-content">
<h3>CodeWrap AI Agents</h3>
<p>You can directly command an agent by starting your prompt with <strong>@AgentName</strong>, for example: <code>@CodeGenerator create a blue button</code>. Or you can customize them via <strong>/settings</strong>.</p>
<h4>The Agents</h4><ul>${agentInfo}</ul></div>`;
            logItem.classList.add('help-panel');
            logItem.innerHTML = agentsHelpText;
            return true;
        default:
            logItem.innerHTML = `<div class="error">Unknown command: ${command}</div>`;
            return true;
    }
}


// --- MAIN PROMPT HANDLER ---

function renderAiResponse(text: string): string {
    // Escape HTML to prevent injection
    let escapedText = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Process file blocks first
    escapedText = escapedText.replace(/\[start of file: (.*?)]\n([\s\S]*?)\[end of file: \1]/g, (match, fileName, code) => {
        const isNewFile = !projectFiles.has(fileName);
        const status = isNewFile ? 'Created' : 'Updated';
        const statusClass = isNewFile ? 'new' : 'updated';

        const codeLines = code.replace(/^```[a-z]*\n|```$/g, '').split('\n').map(line => {
             let className = 'diff-context';
             let lineContent = line;
             if (line.startsWith('+ ')) {
                 className = 'diff-add';
                 lineContent = line.substring(2);
             } else if (line.startsWith('- ')) {
                 className = 'diff-remove';
                 lineContent = line.substring(2);
             }
             return `<span class="${className}">${lineContent.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>`;
        }).join('');

        return `
            <details class="file-card">
                <summary>
                    <div class="file-card-header">
                        <span class="file-status ${statusClass}">${status}</span>
                        <span class="file-name">${fileName}</span>
                    </div>
                    <span class="file-expand-hint">Click to expand</span>
                </summary>
                <div class="file-card-content">
                    <pre><code>${codeLines}</code></pre>
                </div>
            </details>
        `;
    });

    // Process regular code blocks
    escapedText = escapedText.replace(/```([\s\S]*?)```/g, (match, code) => {
        const lines = code.split('\n');
        if (lines.length > 0 && !lines[0].includes(' ')) {
            lines.shift();
        }
        const codeLines = lines.map(line => `<span>${line.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>`).join('');
        return `<pre><code>${codeLines}</code></pre>`;
    });

    // Process other markdown elements
    return escapedText
        .replace(/^\* (.*$)/gm, '<div class="log-ai-thought">• $1</div>') // Bullet points
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
        .replace(/`([^`]+)`/g, '<code>$1</code>'); // Inline code
}


async function executeAIStream(responseBlock: HTMLElement) {
    inputEl.disabled = true;

    const contentWrapper = document.createElement('div');
    responseBlock.appendChild(contentWrapper);

    const statusIndicator = document.createElement('div');
    statusIndicator.className = 'status-indicator';
    statusIndicator.innerHTML = `<span>Thinking...</span>`;
    responseBlock.appendChild(statusIndicator);

    const updateStatus = (text: string) => {
        statusIndicator.innerHTML = `<span>${text}</span>`;
    };

    historyEl.scrollTop = historyEl.scrollHeight;

    try {
        const stream = await ai.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents: [...conversationHistory],
            config: {
                systemInstruction: generateSystemInstruction(),
                tools: [{googleSearch: {}}]
            },
        });
        
        updateStatus('Receiving response...');

        let fullResponse = '';
        let unprocessedText = '';
        const fileRegex = /\[start of file: (.*?)]\n([\s\S]*?)\[end of file: \1]/g;

        for await (const chunk of stream) {
            const chunkText = chunk.text;
            if (!chunkText) {
                continue; // Skip chunks without text
            }
            fullResponse += chunkText;

            // Update status based on content
            if (chunkText.includes('[Planner]')) updateStatus('Planning...');
            else if (chunkText.includes('[CodeGenerator]')) updateStatus('Generating code...');
            else if (chunkText.includes('[WebAppResearcher]')) updateStatus('Searching the web...');
            else if (chunkText.includes('Updating `')) {
                 const match = /Updating `(.*?)`/.exec(chunkText);
                 if (match) updateStatus(`Writing file: ${match[1]}`);
            } else if (chunkText.includes('Creating `')) {
                 const match = /Creating `(.*?)`/.exec(chunkText);
                 if (match) updateStatus(`Writing file: ${match[1]}`);
            }
            
            let match;
            while((match = fileRegex.exec(fullResponse)) !== null) {
                const fileName = match[1].trim();
                const fileContent = match[2].trim().replace(/^```[a-z]*\n|```$/g, '');
                
                const finalFileContent = fileContent.split('\n').map(line => {
                    if (line.startsWith('+ ') || line.startsWith('- ')) {
                        return line.substring(2);
                    }
                    return line.startsWith('  ') ? line.substring(2) : line;
                }).join('\n');
                
                projectFiles.set(fileName, finalFileContent);
                console.log(`Wrote file: ${fileName}`);
            }
            
            contentWrapper.innerHTML = renderAiResponse(fullResponse);
            historyEl.scrollTop = historyEl.scrollHeight;
        }
        
        saveProjectToStorage(); // Auto-save after successful generation
        conversationHistory.push({ role: 'model', parts: [{ text: fullResponse }] });
        
        statusIndicator.classList.add('done');
        updateStatus('Done');
        setTimeout(() => statusIndicator.remove(), 2000);


        if (fullResponse.includes('[awaiting_confirmation]')) {
            isAwaitingConfirmation = true;
            inputEl.disabled = true;
            const confirmationEl = document.createElement('div');
            confirmationEl.className = 'confirmation-controls';
            confirmationEl.innerHTML = `<button class="confirm-yes">✔ Yes, proceed</button><button class="confirm-no">✖ No, cancel</button>`;
            responseBlock.appendChild(confirmationEl);
        }

    } catch (error) {
        console.error(error);
        statusIndicator.remove();
        responseBlock.innerHTML = `<div class="error">Error: An unexpected error occurred. Please check the console.</div>`;
    } finally {
        if (!isAwaitingConfirmation) {
            inputEl.disabled = false;
            inputEl.focus();
        }
        historyEl.scrollTop = historyEl.scrollHeight;
    }
}

async function sendConfirmation(message: 'yes') {
    isAwaitingConfirmation = false;
    addHistoryItem(
        `<span class="prompt-prefix">&gt;</span> <span class="prompt-content">${message}</span>`,
        'log-prompt'
    );
    conversationHistory.push({ role: 'user', parts: [{ text: message }] });
    const responseBlock = addHistoryItem('', 'log-response');
    await executeAIStream(responseBlock);
}


async function handlePrompt(e: SubmitEvent) {
    e.preventDefault();
    if (isAwaitingConfirmation) return;
    if (activeSuggestionIndex > -1) {
        selectSuggestion(activeSuggestionIndex);
        return;
    }

    const originalPrompt = inputEl.value.trim();
    if (!originalPrompt) return;

    addHistoryItem(
        `<span class="prompt-prefix">&gt;</span> <span class="prompt-content">${originalPrompt}</span>`,
        'log-prompt'
    );
    formEl.reset();
    inputEl.focus();

    let promptForProcessing = originalPrompt.toLowerCase();

    // Natural Language Command Handling for 'run'
    const runPhrases = ['run the app', 'run it', 'run the project', 'launch the app', 'launch it', 'start the app'];
    if (runPhrases.includes(promptForProcessing)) {
        promptForProcessing = '/run';
    }

    if (handleClientCommands(originalPrompt)) { // Use original prompt for case-sensitive commands if needed
        historyEl.scrollTop = historyEl.scrollHeight;
        return;
    }

    conversationHistory.push({ role: 'user', parts: [{ text: originalPrompt }] });
    const responseBlock = addHistoryItem('', 'log-response');
    await executeAIStream(responseBlock);
}


// --- INITIALIZATION ---
function showWelcomeMessage() {
    const bannerHTML = `
<div class="simple-banner">CodeWrap<span class="blinking-cursor">_</span></div>
<div class="welcome-box">
<strong>Welcome to CodeWrap!</strong><br/>
Type a prompt like "Create a simple clock" to start.<br/>
Use <code>/help</code> for a list of all commands.
<div class="welcome-footer">Built by <a href="https://x.com/mdayan24X" target="_blank" rel="noopener noreferrer">@mdayan24X</a></div>
</div>
`;
    addHistoryItem(bannerHTML, 'log-system', 'welcome');
}

document.addEventListener('DOMContentLoaded', () => {
    // Initial Setup
    setTimeout(() => loaderEl.classList.add('hidden'), 1500);
    loadAgentsFromStorage();
    loadProjectFromStorage();
    initializeAI();

    // Event Listeners
    const launchIde = () => {
        landingPageEl.classList.add('hidden');
        appContainerEl.classList.remove('hidden');
        if (historyEl.children.length <= 1) { // Check if only the loaded project message is there
            showWelcomeMessage();
        }
        inputEl.focus();
    };

    launchBtn.addEventListener('click', launchIde);
    launchBtnCta.addEventListener('click', launchIde);

    formEl.addEventListener("submit", handlePrompt);

    // Autocomplete Listeners
    inputEl.addEventListener('input', handleAutocomplete);
    inputEl.addEventListener('keydown', handleSuggestionKeydown);
    inputEl.addEventListener('blur', () => setTimeout(hideSuggestions, 200)); // Delay to allow click
    suggestionsPopoverEl.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const item = target.closest('.suggestion-item');
        if (item) {
            const index = parseInt(item.getAttribute('data-index') || '-1');
            selectSuggestion(index);
        }
    });
    
    // Settings Modal Listeners
    settingsBtn.addEventListener('click', () => {
        populateAgentSettingsUI();
        agentSettingsModalEl.classList.remove('hidden');
    });
    closeSettingsBtn.addEventListener('click', () => agentSettingsModalEl.classList.add('hidden'));
    agentSettingsModalEl.querySelector('.modal-backdrop')?.addEventListener('click', () => agentSettingsModalEl.classList.add('hidden'));
    addAgentForm.addEventListener('submit', handleAddAgent);
    saveSettingsBtn.addEventListener('click', () => {
        saveAgentsToStorage();
        initializeAI(); // Re-initialize AI with new system prompt
        agentSettingsModalEl.classList.add('hidden');
        addHistoryItem('<div class="system-confirm-line">✔ AI reloaded with new agent settings.</div>', 'log-system');
    });

    // File Viewer Listeners
    closeViewerBtn.addEventListener('click', hideFileViewer);
    fileViewerModalEl.querySelector('.modal-backdrop')?.addEventListener('click', hideFileViewer);

    // Delegated click listener for dynamic content in history
    historyEl.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.matches('.file-link')) {
            const fileName = target.dataset.filename;
            if (fileName) {
                showFileContent(fileName);
            }
        } else if (target.matches('.confirm-yes')) {
            target.parentElement?.remove(); // Remove confirmation buttons
            sendConfirmation('yes');
        } else if (target.matches('.confirm-no')) {
            target.parentElement?.remove(); // Remove confirmation buttons
            addHistoryItem('<div>✖ Plan cancelled. Waiting for new instructions.</div>', 'log-system');
            isAwaitingConfirmation = false;
            inputEl.disabled = false;
            inputEl.focus();
        }
    });
});