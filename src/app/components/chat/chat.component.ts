import {
  Component, OnInit, ViewChild, ElementRef,
  AfterViewChecked, PLATFORM_ID, Inject, NgZone,
  ChangeDetectorRef, OnDestroy
} from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ChatService, ServerProps } from '../../services/chat.service';
import { Message, AttachedFile } from '../../models/chat.model';
import { marked, Renderer } from 'marked';
import { Subscription } from 'rxjs';

const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface ConversationMeta { id: string; title: string; }

export interface RichMessage extends Message {
  renderedReasoningHtml?: SafeHtml;
  renderedFinalHtml?: SafeHtml;
  reasoningText?: string;
  finalText?: string;
}

export interface UserPrompt {
  id: string; text: string; files: AttachedFile[]; timestamp: Date;
}

interface ConversationState {
  messages: RichMessage[];
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
export class ChatComponent implements OnInit, AfterViewChecked, OnDestroy {
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
  userPrompts:   UserPrompt[]                        = [];
  serverProps:   ServerProps | null                  = null;
  modelAlias:    string                              = 'Loading…';
  contextSize:   number                              = 0;

  private convStore          = new Map<string, ConversationState>();
  private isBrowser          = false;
  private shouldScroll       = false;
  private codeBlockListeners = new Map<Element, boolean>();
  private streamSub:             Subscription | null = null;
  private activeAssistantMsgId:  string | null       = null;
  private stopRequested          = false;

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
          next:  p  => { this.applyProps(p); this.serverOnline = true; },
          error: () => { this.checkServer(); },
        });
      }, 0);
    }
  }

  ngOnDestroy(): void { this.streamSub?.unsubscribe(); }

  private applyProps(props: ServerProps): void {
    this.serverProps = props;
    this.modelAlias  = props.model_alias ?? 'Unknown model';
    this.contextSize = props.default_generation_settings?.n_ctx ?? 0;
  }

  ngAfterViewChecked(): void {
    if (!this.isBrowser) return;
    if (this.shouldScroll) {
      try { this.messagesEnd?.nativeElement.scrollIntoView({ behavior: 'smooth' }); } catch { }
      this.shouldScroll = false;
    }
    document.querySelectorAll('.code-block').forEach(block => {
      if (this.codeBlockListeners.has(block)) return;
      this.codeBlockListeners.set(block, true);
      const btn = block.querySelector('.code-copy-btn') as HTMLButtonElement | null;
      const raw = (block as HTMLElement).getAttribute('data-raw-code');
      if (!btn || !raw) return;
      btn.addEventListener('click', () => {
        const decoded = raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        navigator.clipboard.writeText(decoded).then(() => {
          const [pb, pc] = [btn.style.borderColor, btn.style.color];
          btn.style.borderColor = 'rgba(64,217,134,.55)'; btn.style.color = '#40d986';
          setTimeout(() => { btn.style.borderColor = pb; btn.style.color = pc; }, 2000);
        });
      });
    });
  }

  // ── Markdown ──────────────────────────────────────────────────────────────
  private setupMarked(): void {
    const renderer = new Renderer();
    (renderer as any).code = (code: string, infostring?: string) => {
      const lang = (infostring ?? '').trim().split(/\s+/)[0] || 'plaintext';
      const nl = lang.toLowerCase();
      const isTerm = new Set(['bash','sh','zsh','shell','console','terminal','powershell','ps1','cmd','bat']).has(nl);
      const dl = nl === 'plaintext' ? 'bash' : lang;
      const esc = escapeHtml(code);
      const bg = isTerm ? 'linear-gradient(180deg,#0f131b 0%,#0b0f15 100%)' : '#0b1018';
      return `<div class="${isTerm ? 'code-block terminal-block' : 'code-block'}" data-language="${dl}" data-raw-code="${esc}"
  style="background:${bg};border:1px solid rgba(255,255,255,.12);border-radius:14px;margin:16px 0;overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 6px 26px rgba(0,0,0,.45);">
  <div class="code-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(255,255,255,.02);border-bottom:1px solid rgba(255,255,255,.08);min-height:38px;">
    <span class="code-lang" style="font-size:11px;font-weight:700;color:#C3C3C3;text-transform:uppercase;letter-spacing:.6px;">${dl}</span>
    <button class="code-copy-btn" type="button" title="Copy code" style="width:28px;height:28px;background:transparent;border:1px solid rgba(255,255,255,.14);color:#C3C3C3;padding:0;border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;">
      <svg viewBox="0 0 24 24" fill="white" aria-hidden="true">
  <rect x="9" y="9" width="10" height="10" rx="2" ry="2"/>
  <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>
</svg>
    </button>
  </div>
  <pre class="language-${dl}" style="margin:0;padding:16px 18px 18px;overflow-x:auto;background:transparent;line-height:1.65;"><code class="language-${dl}" style="background:none;border:none;padding:0;color:${isTerm ? '#f6c177' : '#f0f3f8'};font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:13px;white-space:pre;">${esc}</code></pre>
</div>`;
    };
    (renderer as any).table = (h: string, b: string) =>
      `<div class="table-wrapper"><table class="fl-table"><thead>${h}</thead><tbody>${b}</tbody></table></div>`;
    (renderer as any).tablerow  = (c: string) => `<tr>${c}</tr>`;
    (renderer as any).tablecell = (c: string, f: any) => {
      const t = f.header ? 'th' : 'td';
      return `<${t}${f.align ? ` style="text-align:${f.align}"` : ''}>${c}</${t}>`;
    };
    marked.use({ renderer, breaks: true, gfm: true, pedantic: false });
  }

  private renderMarkdown(text: string): SafeHtml {
    let html = marked.parse(text) as string;
    html = html.replace(/\$\$([\s\S]*?)\$\$/g, '<div class="math-block">$1</div>');
    html = html.replace(/\$(.*?)\$/g, '<span class="math-inline">$1</span>');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private renderPlain(text: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(escapeHtml(text).replace(/\n/g, '<br>'));
  }

  private isTable(text: string): boolean {
    return /^\s*\|.+\|\s*$/m.test(text) && /^\s*\|?[\s:-]+(?:\|[\s:-]+)+\|?\s*$/m.test(text);
  }

  private extractSections(raw: string): { reasoning: string; finalAnswer: string } {
    let text = raw
      .replace(/<tool_code>[\s\S]*?<\/tool_code>/gi, '')
      .replace(/<tool_result>[\s\S]*?<\/tool_result>/gi, '')
      .replace(/\n{3,}/g, '\n\n').trim();
    const parts: string[] = [];
    text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, t: string) => {
      const s = t.trim(); if (s) parts.push(s); return '';
    }).trim();
    if (parts.length) return { reasoning: parts.join('\n\n'), finalAnswer: text || 'No final answer.' };
    const m = text.match(/(?:^|\n)\s*#{0,3}\s*reasoning\s*:?\s*\n([\s\S]*?)\n\s*#{0,3}\s*final(?:\s+answer)?\s*:?\s*\n([\s\S]*)$/i);
    if (m) return { reasoning: m[1].trim(), finalAnswer: m[2].trim() || 'No final answer.' };
    return { reasoning: '', finalAnswer: text || 'No response. Please try again.' };
  }

  private cleanResponse(raw: string): string {
    return raw.replace(/<tool_code>[\s\S]*?<\/tool_code>/gi, '')
      .replace(/<tool_result>[\s\S]*?<\/tool_result>/gi, '')
      .replace(/\n{3,}/g, '\n\n').trim() || 'No response. Please try again.';
  }

  private updateMessageHtml(msg: RichMessage): void {
    if (!msg.content) { msg.renderedReasoningHtml = undefined; msg.renderedFinalHtml = undefined; return; }
    try {
      const s = this.extractSections(msg.content);
      msg.reasoningText = s.reasoning; msg.finalText = s.finalAnswer;
      msg.renderedReasoningHtml = s.reasoning   ? this.renderMarkdown(s.reasoning)   : undefined;
      msg.renderedFinalHtml     = s.finalAnswer ? this.renderMarkdown(s.finalAnswer) : undefined;
    } catch {
      msg.renderedFinalHtml = this.sanitizer.bypassSecurityTrustHtml(msg.content.replace(/\n/g, '<br>'));
    }
  }

  // ── THE KEY METHOD ────────────────────────────────────────────────────────
  // This is passed as the `onChunk` callback to sendMessageStream().
  // It runs synchronously inside the fetch read loop.
  // It updates the message and calls cdr.detectChanges() directly —
  // this works regardless of zone, regardless of Angular version.
  private makeChunkHandler(msgId: string): (text: string) => void {
    return (fullText: string) => {
      this.zone.run(() => {
        const msg = this.messages.find(m => m.id === msgId);
        if (!msg || msg.content === fullText) return;

        msg.content = fullText;
        const s = this.extractSections(fullText);
        msg.reasoningText = s.reasoning;
        msg.finalText = s.finalAnswer;

        msg.renderedReasoningHtml = s.reasoning
          ? (this.isTable(s.reasoning) ? this.renderMarkdown(s.reasoning) : this.renderPlain(s.reasoning))
          : undefined;
        msg.renderedFinalHtml = this.isTable(s.finalAnswer)
          ? this.renderMarkdown(s.finalAnswer)
          : this.renderPlain(s.finalAnswer);

        this.shouldScroll = true;
        this.messages = [...this.messages];
        this.cdr.markForCheck();
        this.cdr.detectChanges();
      });
    };
  }

  // Conversation management
  private saveCurrentConv(): void {
    if (!this.currentConvId) return;
    this.convStore.set(this.currentConvId, {
      messages: [...this.messages], chatHistory: [...this.chatHistory], userPrompts: [...this.userPrompts],
    });
  }

  private loadConv(id: string): void {
    const s = this.convStore.get(id);
    if (s) { this.messages = [...s.messages]; this.chatHistory = [...s.chatHistory]; this.userPrompts = [...s.userPrompts]; }
    else   { this.messages = []; this.chatHistory = []; this.userPrompts = []; }
  }

  newConversation(): void {
    this.saveCurrentConv();
    const id = Date.now().toString();
    this.conversations.unshift({ id, title: 'New conversation' });
    this.currentConvId = id;
    this.convStore.set(id, { messages: [], chatHistory: [], userPrompts: [] });
    this.messages = []; this.chatHistory = []; this.userPrompts = [];
    this.clearFiles(); this.userInput = '';
  }

  selectConversation(id: string): void {
    if (id === this.currentConvId) return;
    this.saveCurrentConv(); this.currentConvId = id; this.loadConv(id);
    this.clearFiles(); this.userInput = ''; this.shouldScroll = true;
  }

  deleteConversation(id: string, e: Event): void {
    e.stopPropagation();
    this.convStore.delete(id);
    this.conversations = this.conversations.filter(c => c.id !== id);
    if (this.currentConvId === id) {
      if (this.conversations.length > 0) { this.currentConvId = this.conversations[0].id; this.loadConv(this.currentConvId); }
      else { this.newConversation(); return; }
    }
  }

  checkServer(): void {
    this.chatService.checkHealth().subscribe({
      next:  () => { this.serverOnline = true; },
      error: () => { this.serverOnline = false; },
    });
  }

  refreshProps(): void {
    this.chatService.fetchAndCacheProps().subscribe({
      next:  p  => { this.applyProps(p); this.serverOnline = true; },
      error: () => { this.serverOnline = false; },
    });
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) this.addFiles(Array.from(input.files)); input.value = '';
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
  clearFiles(): void { this.selectedFiles = []; this.filePreviews = []; }
  onDragOver(e: DragEvent): void { e.preventDefault(); this.isDragging = true; }
  onDragLeave(): void { this.isDragging = false; }
  onDrop(e: DragEvent): void {
    e.preventDefault(); this.isDragging = false;
    if (e.dataTransfer?.files) this.addFiles(Array.from(e.dataTransfer.files));
  }
  onKeyDown(e: KeyboardEvent): void { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } }
  autoResize(e: Event): void {
    const t = e.target as HTMLTextAreaElement;
    t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 180) + 'px';
  }
  get canSend(): boolean { return (!!this.userInput.trim() || this.selectedFiles.length > 0) && !this.isLoading; }

  getFileIcon(type: string): string {
    if (type.startsWith('image/')) return '🖼️'; if (type.startsWith('audio/')) return '🎵';
    if (type.startsWith('video/')) return '🎬'; if (type.includes('pdf')) return '📄';
    if (type.includes('word') || type.includes('document')) return '📝';
    if (type.includes('sheet') || type.includes('excel')) return '📊';
    if (type.includes('text')) return '📃'; return '📎';
  }
  formatSize(b: number): string {
    if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  formatTime(d: Date): string { return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  copyMessage(id: string, content: string): void {
    navigator.clipboard.writeText(content).then(() => { this.copiedId = id; setTimeout(() => (this.copiedId = ''), 2000); });
  }
  getUserPrompt(msgId: string): UserPrompt | undefined { return this.userPrompts.find(p => p.id === msgId); }
  isLastUserPrompt(promptId: string): boolean {
    if (!this.userPrompts.length || this.isLoading) return false;
    return this.userPrompts[this.userPrompts.length - 1].id === promptId;
  }
  editUserPrompt(prompt: UserPrompt): void {
    if (!this.isLastUserPrompt(prompt.id)) return;
    this.userInput = prompt.text; this.clearFiles();
    if (this.textarea?.nativeElement) {
      const el = this.textarea.nativeElement as HTMLTextAreaElement;
      el.focus(); el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 180) + 'px';
    }
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  send(): void {
    if (!this.canSend) return;

    const msgId = Date.now().toString();
    this.userPrompts.push({ id: msgId, text: this.userInput, files: [...this.filePreviews], timestamp: new Date() });
    this.messages.push({ id: msgId, role: 'user', content: this.userInput, files: [...this.filePreviews], timestamp: new Date() });
    this.shouldScroll = true;

    const conv = this.conversations.find(c => c.id === this.currentConvId);
    if (conv && conv.title === 'New conversation') conv.title = this.userInput.slice(0, 40);

    const payload = [...this.chatHistory.slice(-4), { role: 'user', content: this.userInput }];
    this.chatHistory.push({ role: 'user', content: this.userInput });

    this.userInput = ''; this.clearFiles();
    if (this.textarea) this.textarea.nativeElement.style.height = 'auto';
    this.isLoading = true;

    const aiMsgId = (Date.now() + 1).toString();
    this.messages.push({ id: aiMsgId, role: 'assistant', content: '', timestamp: new Date() });
    this.activeAssistantMsgId = aiMsgId;
    this.stopRequested = false;
    this.shouldScroll  = true;
    this.cdr.detectChanges(); // show the loading bubble immediately

    const convId = this.currentConvId;
    this.streamSub?.unsubscribe();

    // ── Pass the chunk handler directly into the stream ───────────────────
    // onChunk is called synchronously on every token inside the fetch loop.
    // It calls cdr.detectChanges() which forces the view to update immediately.
    const onChunk = this.makeChunkHandler(aiMsgId);

    this.streamSub = this.chatService.sendMessageStream(payload, onChunk).subscribe({
      next: (finalText: string) => {
        // final text received — update convStore
        const stored = this.convStore.get(convId);
        if (stored) { const m = stored.messages.find(m => m.id === aiMsgId); if (m) m.content = finalText; }
      },
      error: (err: any) => {
        this.streamSub = null; this.activeAssistantMsgId = null;
        if (this.stopRequested) { this.stopRequested = false; return; }
        this.isLoading = false; this.serverOnline = false;
        const msg = this.messages.find(m => m.id === aiMsgId);
        if (msg) {
          msg.content = (err?.message?.includes('TimeoutError') || err?.name === 'TimeoutError')
            ? 'Timed out. Try a shorter message.' : `Connection error: ${err?.message ?? 'Check llama-server at 192.168.14.74:8080'}`;
          this.updateMessageHtml(msg);
        }
        this.shouldScroll = true; this.saveCurrentConv(); this.cdr.detectChanges();
      },
      complete: () => {
        this.streamSub = null; this.activeAssistantMsgId = null;
        this.isLoading = false; this.serverOnline = true;
        const msg = this.messages.find(m => m.id === aiMsgId);
        if (msg) {
          msg.content = this.cleanResponse(msg.content);
          const { finalAnswer } = this.extractSections(msg.content);
          this.chatHistory.push({ role: 'assistant', content: finalAnswer });
          this.updateMessageHtml(msg); // full markdown on finish
        }
        this.shouldScroll = true; this.saveCurrentConv(); this.cdr.detectChanges();
      },
    });
  }

  // ── Pause ─────────────────────────────────────────────────────────────────
  pauseGeneration(): void {
    if (!this.isLoading) return;
    this.stopRequested = true;
    this.streamSub?.unsubscribe(); this.streamSub = null;
    this.isLoading = false;
    if (this.activeAssistantMsgId) {
      const msg = this.messages.find(m => m.id === this.activeAssistantMsgId);
      if (msg?.content) {
        msg.content = this.cleanResponse(msg.content);
        this.updateMessageHtml(msg);
        const { finalAnswer } = this.extractSections(msg.content);
        this.chatHistory.push({ role: 'assistant', content: finalAnswer });
      }
    }
    this.activeAssistantMsgId = null; this.shouldScroll = true;
    this.saveCurrentConv(); this.cdr.detectChanges();
  }
}

