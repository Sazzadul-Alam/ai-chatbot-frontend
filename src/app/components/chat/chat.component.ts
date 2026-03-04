import {
  Component, OnInit, ViewChild, ElementRef,
  AfterViewChecked, PLATFORM_ID, Inject, NgZone, ChangeDetectorRef
} from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ChatService, ServerProps } from '../../services/chat.service';
import { Message, AttachedFile } from '../../models/chat.model';
import { marked, Renderer } from 'marked';
import { Subscription } from 'rxjs';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export interface ConversationMeta { id: string; title: string; }

export interface RichMessage extends Message {
  renderedReasoningHtml?: SafeHtml;
  renderedFinalHtml?: SafeHtml;
  reasoningText?: string;
  finalText?: string;
}

// ── Separate user prompt store ─────────────────────────────────────────────
export interface UserPrompt {
  id:        string;
  text:      string;
  files:     AttachedFile[];
  timestamp: Date;
}

interface ConversationState {
  messages:    RichMessage[];
  chatHistory: { role: string; content: string }[];
  userPrompts: UserPrompt[];
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css'],
  providers: [ChatService],
})
export class ChatComponent implements OnInit, AfterViewChecked {
  @ViewChild('messagesEnd') private messagesEnd!: ElementRef;
  @ViewChild('fileInput')   private fileInput!:   ElementRef;
  @ViewChild('textarea')    private textarea!:    ElementRef;

  messages:      RichMessage[]                       = [];
  userInput:     string                              = '';
  isLoading:     boolean                             = false;
  serverOnline:  boolean                             = false;
  sidebarOpen:   boolean                             = true;
  isDragging:    boolean                             = false;
  selectedFiles: File[]                              = [];
  filePreviews:  AttachedFile[]                      = [];
  chatHistory:   { role: string; content: string }[] = [];
  conversations: ConversationMeta[]                  = [];
  currentConvId: string                              = '';
  copiedId:      string                              = '';

  // ── Separate user prompts array ──────────────────────────────────────────
  userPrompts: UserPrompt[] = [];

  serverProps:  ServerProps | null = null;
  modelAlias:   string             = 'Loading…';
  contextSize:  number             = 0;

  private convStore          = new Map<string, ConversationState>();
  private isBrowser          = false;
  private shouldScroll       = false;
  private codeBlockListeners = new Map<Element, boolean>();
  private streamSub: Subscription | null = null;
  private activeAssistantMsgId: string | null = null;
  private stopRequested = false;

  constructor(
    private chatService: ChatService,
    private sanitizer:   DomSanitizer,
    private zone:        NgZone,
    private cdr:         ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object,
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    if (this.isBrowser) this.setupMarked();
  }

  ngOnInit(): void {
    this.newConversation();

    if (this.isBrowser) {
      const cached = this.chatService.getProps();
      if (cached) this.applyProps(cached);

      setTimeout(() => {
        this.chatService.fetchAndCacheProps().subscribe({
          next:  props => { this.applyProps(props); this.serverOnline = true;  this.cdr.markForCheck(); },
          error: ()    => { this.checkServer(); },
        });
      }, 0);
    }
  }

  private applyProps(props: ServerProps): void {
    this.serverProps = props;
    this.modelAlias  = props.model_alias ?? 'Unknown model';
    this.contextSize = props.default_generation_settings?.n_ctx ?? 0;
  }

  ngAfterViewChecked(): void {
    if (!this.isBrowser) return;
    if (this.shouldScroll) {
      try { this.messagesEnd?.nativeElement.scrollIntoView({ behavior: 'smooth' }); } catch {}
      this.shouldScroll = false;
    }
    document.querySelectorAll('.code-block').forEach(block => {
      if (this.codeBlockListeners.has(block)) return;
      this.codeBlockListeners.set(block, true);
      const btn = block.querySelector('.code-copy-btn') as HTMLButtonElement | null;
      const raw = (block as HTMLElement).getAttribute('data-raw-code');
      if (!btn || !raw) return;

      btn.addEventListener('click', () => {
        const decoded = raw
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&');

        navigator.clipboard.writeText(decoded).then(() => {
          const prevBorder = btn.style.borderColor;
          const prevColor = btn.style.color;
          btn.style.borderColor = 'rgba(64, 217, 134, 0.55)';
          btn.style.color = '#40d986';
          setTimeout(() => {
            btn.style.borderColor = prevBorder;
            btn.style.color = prevColor;
          }, 2000);
        });
      });
    });
  }

  private setupMarked(): void {
    const renderer = new Renderer();

    (renderer as any).code = function(code: string, infostring?: string): string {
      const lang = (infostring ?? '').trim().split(/\s+/)[0] || 'plaintext';
      const normalizedLang = lang.toLowerCase();
      const terminalLangs = new Set([
        'bash', 'sh', 'zsh', 'shell', 'console', 'terminal',
        'powershell', 'ps1', 'cmd', 'bat',
      ]);
      const isTerminal = terminalLangs.has(normalizedLang);
      const displayLang = normalizedLang === 'plaintext' ? 'bash' : lang;
      const escapedCode = escapeHtml(code);
      const escapedRaw = escapeHtml(code);
      const blockClass = isTerminal ? 'code-block terminal-block' : 'code-block';
      const blockBg = isTerminal ? 'linear-gradient(180deg,#0f131b 0%,#0b0f15 100%)' : '#0b1018';

      return `
<div class="${blockClass}" data-language="${displayLang}" data-raw-code="${escapedRaw}"
  style="background:${blockBg};border:1px solid rgba(255,255,255,.12);border-radius:14px;margin:16px 0;overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 6px 26px rgba(0,0,0,.45);">
  <div class="code-header"
    style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(255,255,255,.02);border-bottom:1px solid rgba(255,255,255,.08);min-height:38px;">
    <span class="code-lang"
      style="font-size:11px;font-weight:700;color:rgba(255,255,255,.92);text-transform:uppercase;letter-spacing:.6px;">${displayLang}</span>
    <button class="code-copy-btn" type="button" title="Copy code" aria-label="Copy code"
      style="width:28px;height:28px;background:transparent;border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.78);padding:0;border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="9" y="9" width="10" height="10" rx="2" ry="2"></rect>
        <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path>
      </svg>
    </button>
  </div>
  <pre class="language-${displayLang}"
    style="margin:0;padding:16px 18px 18px;overflow-x:auto;background:transparent;line-height:1.65;"><code class="language-${displayLang}"
    style="background:none;border:none;padding:0;color:${isTerminal ? '#f6c177' : '#f0f3f8'};font-family:'Cascadia Code','Fira Code','Consolas','Courier New',monospace;font-size:13px;line-height:1.65;white-space:pre;">${escapedCode}</code></pre>
</div>`;
    };

    (renderer as any).table = function(header: string, body: string): string {
      return `
<style>
.table-wrapper{
  margin:10px 70px 70px;
  box-shadow:0 35px 50px rgba(0,0,0,.2);
}
.fl-table{
  border-radius:5px;
  font-size:12px;
  font-weight:400;
  border:none;
  border-collapse:collapse;
  width:100%;
  max-width:100%;
  white-space:nowrap;
  background-color:#fff;
  color: black;
}
.fl-table td,.fl-table th{
  text-align:center;
  padding:8px;
}
.fl-table td{
  border-right:1px solid #f8f8f8;
  font-size:12px;
}
.fl-table thead th{
  color:#fff;
  background:#4FC3A1;
}
.fl-table thead th:nth-child(odd){
  color:#fff;
  background:#324960;
}
.fl-table tr:nth-child(even){
  background:#F8F8F8;
}
@media (max-width:767px){
  .fl-table{display:block;width:100%;}
  .table-wrapper:before{
    content:"Scroll horizontally >";
    display:block;
    text-align:right;
    font-size:11px;
    color:#fff;
    padding:0 0 10px;
  }
  .fl-table thead,.fl-table tbody,.fl-table thead th{display:block;}
  .fl-table thead th:last-child{border-bottom:none;}
  .fl-table thead{float:left;}
  .fl-table tbody{width:auto;position:relative;overflow-x:auto;}
  .fl-table td,.fl-table th{
    padding:20px .625em .625em .625em;
    height:60px;
    vertical-align:middle;
    box-sizing:border-box;
    overflow-x:hidden;
    overflow-y:auto;
    width:120px;
    font-size:13px;
    text-overflow:ellipsis;
  }
  .fl-table thead th{text-align:left;border-bottom:1px solid #f7f7f9;}
  .fl-table tbody tr{display:table-cell;}
  .fl-table tbody tr:nth-child(odd){background:none;}
  .fl-table tr:nth-child(even){background:transparent;}
  .fl-table tr td:nth-child(odd){background:#F8F8F8;border-right:1px solid #E6E4E4;}
  .fl-table tr td:nth-child(even){border-right:1px solid #E6E4E4;}
  .fl-table tbody td{display:block;text-align:center;}
}
</style>
<div class="table-wrapper"><table class="fl-table"><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
    };
    (renderer as any).tablerow = function(content: string): string {
      return `<tr>${content}</tr>`;
    };
    (renderer as any).tablecell = function(
      content: string,
      flags: { header: boolean; align: 'center' | 'left' | 'right' | null }
    ): string {
      const tag   = flags.header ? 'th' : 'td';
      const align = flags.align  ? ` style="text-align:${flags.align}"` : '';
      return `<${tag}${align}>${content}</${tag}>`;
    };

    marked.use({ renderer, breaks: true, gfm: true, pedantic: false });
  }

  private updateMessageHtml(msg: RichMessage): void {
    if (!msg.content) {
      msg.renderedReasoningHtml = undefined;
      msg.renderedFinalHtml = undefined;
      msg.reasoningText = '';
      msg.finalText = '';
      return;
    }

    try {
      const sections = this.extractAnswerSections(msg.content);
      msg.reasoningText = sections.reasoning;
      msg.finalText = sections.finalAnswer;
      msg.renderedReasoningHtml = sections.reasoning ? this.renderMarkdown(sections.reasoning) : undefined;
      msg.renderedFinalHtml = sections.finalAnswer ? this.renderMarkdown(sections.finalAnswer) : undefined;
    } catch {
      msg.reasoningText = '';
      msg.finalText = msg.content;
      msg.renderedReasoningHtml = undefined;
      msg.renderedFinalHtml = this.sanitizer.bypassSecurityTrustHtml(msg.content.replace(/\n/g, '<br>'));
    }
  }

  private renderMarkdown(text: string): SafeHtml {
    let html = marked.parse(text) as string;
    html = html.replace(/\$\$([\s\S]*?)\$\$/g, '<div class="math-block">$1</div>');
    html = html.replace(/\$(.*?)\$/g, '<span class="math-inline">$1</span>');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private renderStreamingPlain(text: string): SafeHtml {
    const html = escapeHtml(text).replace(/\n/g, '<br>');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private looksLikeMarkdownTable(text: string): boolean {
    const hasRow = /^\s*\|.+\|\s*$/m.test(text);
    const hasDivider = /^\s*\|?[\s:-]+(?:\|[\s:-]+)+\|?\s*$/m.test(text);
    return hasRow && hasDivider;
  }

  private extractAnswerSections(raw: string): { reasoning: string; finalAnswer: string } {
    let text = raw
      .replace(/<tool_code>[\s\S]*?<\/tool_code>/gi, '')
      .replace(/<tool_result>[\s\S]*?<\/tool_result>/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const reasoningParts: string[] = [];
    text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, thought: string) => {
      const trimmed = thought.trim();
      if (trimmed) reasoningParts.push(trimmed);
      return '';
    }).trim();

    if (reasoningParts.length > 0) {
      return {
        reasoning: reasoningParts.join('\n\n'),
        finalAnswer: text || 'No final answer provided.',
      };
    }

    const sectionMatch = text.match(
      /(?:^|\n)\s*#{0,3}\s*reasoning\s*:?\s*\n([\s\S]*?)\n\s*#{0,3}\s*final(?:\s+answer)?\s*:?\s*\n([\s\S]*)$/i
    );
    if (sectionMatch) {
      return {
        reasoning: sectionMatch[1].trim(),
        finalAnswer: sectionMatch[2].trim() || 'No final answer provided.',
      };
    }

    return { reasoning: '', finalAnswer: text || 'No response. Please try again.' };
  }

  private saveCurrentConv(): void {
    if (!this.currentConvId) return;
    this.convStore.set(this.currentConvId, {
      messages:    [...this.messages],
      chatHistory: [...this.chatHistory],
      userPrompts: [...this.userPrompts],
    });
  }

  private loadConv(id: string): void {
    const state = this.convStore.get(id);
    if (state) {
      this.messages    = [...state.messages];
      this.chatHistory = [...state.chatHistory];
      this.userPrompts = [...state.userPrompts];
    } else {
      this.messages    = [];
      this.chatHistory = [];
      this.userPrompts = [];
    }
  }

  checkServer(): void {
    this.chatService.checkHealth().subscribe({
      next:  () => { this.serverOnline = true;  this.cdr.markForCheck(); },
      error: () => { this.serverOnline = false; this.cdr.markForCheck(); },
    });
  }

  refreshProps(): void {
    this.chatService.fetchAndCacheProps().subscribe({
      next:  props => { this.applyProps(props); this.serverOnline = true;  this.cdr.markForCheck(); },
      error: ()    => { this.serverOnline = false; this.cdr.markForCheck(); },
    });
  }

  newConversation(): void {
    this.saveCurrentConv();
    const id = Date.now().toString();
    this.conversations.unshift({ id, title: 'New conversation' });
    this.currentConvId = id;
    this.convStore.set(id, { messages: [], chatHistory: [], userPrompts: [] });
    this.messages    = [];
    this.chatHistory = [];
    this.userPrompts = [];
    this.clearFiles();
    this.userInput   = '';
    this.cdr.markForCheck();
  }

  selectConversation(id: string): void {
    if (id === this.currentConvId) return;
    this.saveCurrentConv();
    this.currentConvId = id;
    this.loadConv(id);
    this.clearFiles();
    this.userInput    = '';
    this.shouldScroll = true;
    this.cdr.markForCheck();
  }

  deleteConversation(id: string, e: Event): void {
    e.stopPropagation();
    this.convStore.delete(id);
    this.conversations = this.conversations.filter(c => c.id !== id);
    if (this.currentConvId === id) {
      if (this.conversations.length > 0) {
        this.currentConvId = this.conversations[0].id;
        this.loadConv(this.currentConvId);
      } else {
        this.newConversation();
        return;
      }
    }
    this.cdr.markForCheck();
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) this.addFiles(Array.from(input.files));
    input.value = '';
  }

  addFiles(files: File[]): void {
    files.forEach(file => {
      this.selectedFiles.push(file);
      const preview: AttachedFile = { name: file.name, type: file.type, size: file.size };
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e: ProgressEvent<FileReader>) => { preview.url = e.target?.result as string; };
        reader.readAsDataURL(file);
      }
      this.filePreviews.push(preview);
    });
  }

  removeFile(i: number): void { this.selectedFiles.splice(i, 1); this.filePreviews.splice(i, 1); }
  clearFiles(): void          { this.selectedFiles = []; this.filePreviews = []; }

  onDragOver(e: DragEvent): void { e.preventDefault(); this.isDragging = true; }
  onDragLeave():            void { this.isDragging = false; }
  onDrop(e: DragEvent):     void {
    e.preventDefault(); this.isDragging = false;
    if (e.dataTransfer?.files) this.addFiles(Array.from(e.dataTransfer.files));
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
  }

  autoResize(e: Event): void {
    const t = e.target as HTMLTextAreaElement;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 180) + 'px';
  }

  get canSend(): boolean {
    return (!!this.userInput.trim() || this.selectedFiles.length > 0) && !this.isLoading;
  }

  getFileIcon(type: string): string {
    if (type.startsWith('image/'))  return '🖼️';
    if (type.startsWith('audio/'))  return '🎵';
    if (type.startsWith('video/'))  return '🎬';
    if (type.includes('pdf'))       return '📄';
    if (type.includes('word') || type.includes('document')) return '📝';
    if (type.includes('sheet') || type.includes('excel'))   return '📊';
    if (type.includes('text'))      return '📃';
    return '📎';
  }

  formatSize(bytes: number): string {
    if (bytes < 1024)    return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  copyMessage(id: string, content: string): void {
    navigator.clipboard.writeText(content).then(() => {
      this.copiedId = id;
      setTimeout(() => (this.copiedId = ''), 2000);
    });
  }

  // ── Helper: find user prompt by message id ────────────────────────────────
  getUserPrompt(msgId: string): UserPrompt | undefined {
    return this.userPrompts.find(p => p.id === msgId);
  }

  isLastUserPrompt(promptId: string): boolean {
    if (this.userPrompts.length === 0 || this.isLoading) return false;
    return this.userPrompts[this.userPrompts.length - 1].id === promptId;
  }

  editUserPrompt(prompt: UserPrompt): void {
    if (!this.isLastUserPrompt(prompt.id)) return;
    this.userInput = prompt.text;
    this.clearFiles();
    this.cdr.detectChanges();

    if (this.textarea?.nativeElement) {
      const el = this.textarea.nativeElement as HTMLTextAreaElement;
      el.focus();
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 180) + 'px';
    }
  }

  private cleanResponse(raw: string): string {
    let text = raw;
    text = text.replace(/<tool_code>[\s\S]*?<\/tool_code>/gi, '');
    text = text.replace(/<tool_result>[\s\S]*?<\/tool_result>/gi, '');
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    return text || 'No response. Please try again.';
  }

  send(): void {
    if (!this.canSend) return;

    const msgId = Date.now().toString();

    // ── Store prompt separately in userPrompts ──────────────────────────────
    const prompt: UserPrompt = {
      id:        msgId,
      text:      this.userInput,
      files:     [...this.filePreviews],
      timestamp: new Date(),
    };
    this.userPrompts.push(prompt);

    // ── Also push to messages[] so the chat renders it ──────────────────────
    const userMsg: RichMessage = {
      id:        msgId,
      role:      'user',
      content:   this.userInput,
      files:     [...this.filePreviews],
      timestamp: new Date(),
    };
    this.messages.push(userMsg);
    this.shouldScroll = true;

    const conv = this.conversations.find(c => c.id === this.currentConvId);
    if (conv && conv.title === 'New conversation') conv.title = this.userInput.slice(0, 40);

    const messagesPayload: { role: string; content: string }[] = [
      ...this.chatHistory.slice(-4),
      { role: 'user', content: this.userInput },
    ];
    this.chatHistory.push({ role: 'user', content: this.userInput });

    this.userInput = '';
    this.clearFiles();
    if (this.textarea) this.textarea.nativeElement.style.height = 'auto';
    this.isLoading = true;

    const aiMsgId = (Date.now() + 1).toString();
    const aiMsg: RichMessage = { id: aiMsgId, role: 'assistant', content: '', timestamp: new Date() };
    this.messages.push(aiMsg);
    this.activeAssistantMsgId = aiMsgId;
    this.stopRequested = false;
    this.shouldScroll = true;
    this.cdr.detectChanges();

    const streamingConvId = this.currentConvId;

    this.streamSub?.unsubscribe();
    this.streamSub = this.chatService.sendMessageStream(messagesPayload).subscribe({
      next: (fullText: string) => {
        const msg = this.messages.find(m => m.id === aiMsgId);
        if (msg) {
          msg.content = fullText;
          const sections = this.extractAnswerSections(fullText);
          msg.reasoningText = sections.reasoning;
          msg.finalText = sections.finalAnswer;
          msg.renderedReasoningHtml = sections.reasoning
            ? (this.looksLikeMarkdownTable(sections.reasoning)
              ? this.renderMarkdown(sections.reasoning)
              : this.renderStreamingPlain(sections.reasoning))
            : undefined;
          msg.renderedFinalHtml = this.looksLikeMarkdownTable(sections.finalAnswer)
            ? this.renderMarkdown(sections.finalAnswer)
            : this.renderStreamingPlain(sections.finalAnswer);
          this.shouldScroll = true;
          this.cdr.detectChanges();
        }
        const stored = this.convStore.get(streamingConvId);
        if (stored) {
          const storedMsg = stored.messages.find(m => m.id === aiMsgId);
          if (storedMsg) storedMsg.content = fullText;
        }
      },
      error: (err: any) => {
        this.streamSub = null;
        this.activeAssistantMsgId = null;
        if (this.stopRequested) {
          this.stopRequested = false;
          return;
        }
        this.isLoading    = false;
        this.serverOnline = false;
        const msg = this.messages.find(m => m.id === aiMsgId);
        if (msg) {
          const isTimeout = err?.name === 'TimeoutError' || err?.message?.includes('abort');
          msg.content = isTimeout
            ? '⏱️ Timed out. The model is running on CPU — try a shorter message.'
            : `⚠️ Connection error: ${err?.message ?? 'Make sure llama-server is running at 192.168.14.74:8080'}`;
          this.updateMessageHtml(msg);
        }
        this.shouldScroll = true;
        this.saveCurrentConv();
        this.cdr.detectChanges();
      },
      complete: () => {
        this.streamSub = null;
        this.activeAssistantMsgId = null;
        this.isLoading    = false;
        this.serverOnline = true;
        const msg = this.messages.find(m => m.id === aiMsgId);
        if (msg) {
          msg.content = this.cleanResponse(msg.content);
          const { finalAnswer } = this.extractAnswerSections(msg.content);
          this.chatHistory.push({ role: 'assistant', content: finalAnswer });
          this.updateMessageHtml(msg);
        }
        this.shouldScroll = true;
        this.saveCurrentConv();
        this.cdr.detectChanges();
      },
    });
  }

  pauseGeneration(): void {
    if (!this.isLoading) return;

    this.stopRequested = true;
    this.streamSub?.unsubscribe();
    this.streamSub = null;
    this.isLoading = false;

    if (this.activeAssistantMsgId) {
      const msg = this.messages.find(m => m.id === this.activeAssistantMsgId);
      if (msg && msg.content) {
        msg.content = this.cleanResponse(msg.content);
        this.updateMessageHtml(msg);
        const { finalAnswer } = this.extractAnswerSections(msg.content);
        this.chatHistory.push({ role: 'assistant', content: finalAnswer });
      }
    }

    this.activeAssistantMsgId = null;
    this.shouldScroll = true;
    this.saveCurrentConv();
    this.cdr.detectChanges();
  }
}
